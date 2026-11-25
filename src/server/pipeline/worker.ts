import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { FailureCode } from "@/lib/contract";
import { db, schema } from "@/server/db/client";
import { deliverWebhook, disableFailingWebhooks, relayEvents } from "@/server/events";
import { log } from "@/server/log";
import { providerStatus } from "./providers/registry";
import { boss, enqueueDelivery, QUEUES, stopQueue, type DeliveryJob, type QueueName, type StageJob, type StageName } from "./queue";
import { analyze } from "./stages/analyze";
import { failRun, StageError, type StageCtx } from "./stages/common";
import { finalize } from "./stages/finalize";
import { ingest } from "./stages/ingest";
import { prepare } from "./stages/prepare";
import { transcribe } from "./stages/transcribe";

/**
 * The worker: stage handlers, the outbox relay (every 2 s) and the sweeper (every minute).
 * Runs inside the web process when ROLE=all (src/instrumentation.ts), or alone with ROLE=worker
 * (scripts/worker.ts). Several workers can run at once: jobs are claimed with SKIP LOCKED.
 */
const STAGES: Record<StageName, (job: StageJob, ctx: StageCtx) => Promise<void>> = { ingest, prepare, transcribe, analyze, finalize };
const DEFAULT_CODE: Record<StageName, FailureCode> = { ingest: "audio_unreachable", prepare: "audio_invalid", transcribe: "transcription_failed", analyze: "analysis_failed", finalize: "analysis_failed" };

const g = globalThis as unknown as { worker?: { timers: NodeJS.Timeout[] } };

export async function startWorker() {
  if (g.worker) return;
  g.worker = { timers: [] };
  const status = providerStatus();
  if (status.error) throw new Error(`Provider configuration: ${status.error}`);
  const b = await boss();

  for (const stage of Object.keys(STAGES) as StageName[]) {
    const q = QUEUES[stage];
    await b.work<StageJob>(stage, { localConcurrency: q.concurrency(), pollingIntervalSeconds: 1 }, async ([job]) => {
      const ctx = { attempt: job.retryCount + 1, lastAttempt: job.retryCount >= q.retryLimit };
      const started = Date.now();
      try {
        await STAGES[stage](job.data, ctx);
        log.info("stage done", { stage, conversationId: job.data.conversationId, ms: Date.now() - started });
      } catch (e) {
        const se = e instanceof StageError ? e : null;
        if (se && (!se.retryable || ctx.lastAttempt)) return failRun(job.data.conversationId, job.data.analysisId, se.code, se.message, se.retryable);
        if (ctx.lastAttempt) return failRun(job.data.conversationId, job.data.analysisId, DEFAULT_CODE[stage], (e as Error).message, true);
        log.warn("stage failed; will retry", { stage, conversationId: job.data.conversationId, attempt: ctx.attempt, err: e });
        throw e;
      }
    });
  }
  const wq = QUEUES.webhook;
  await b.work<DeliveryJob>("webhook", { localConcurrency: wq.concurrency(), pollingIntervalSeconds: 1 }, async ([job]) => {
    await deliverWebhook(job.data, job.retryCount + 1);
  });

  let relaying = false;
  g.worker.timers.push(setInterval(async () => {
    if (relaying) return;
    relaying = true;
    try {
      await relayEvents(enqueueDelivery);
    } catch (e) {
      log.error("event relay failed", { err: e });
    } finally {
      relaying = false;
    }
  }, Number(process.env.RELAY_INTERVAL_MS ?? 2000)));
  g.worker.timers.push(setInterval(() => sweep().catch((e) => log.error("sweeper failed", { err: e })), 60_000));

  log.info("worker started", { llm: status.llm, asr: status.asr, llmFallback: status.llmFallback, asrFallback: status.asrFallback, queues: Object.keys(QUEUES).join(",") });
}

export async function stopWorker() {
  for (const t of g.worker?.timers ?? []) clearInterval(t);
  g.worker = undefined;
  await stopQueue();
}

const STUCK_MIN = Number(process.env.STUCK_AFTER_MIN ?? 30);

/** Fails conversations whose stage hasn't moved in 30 min, disables dead webhooks, applies retention, trims rate-limit rows. */
export async function sweep() {
  const { conversations: conv, analyses } = schema;
  const stuck = await db.select({ id: conv.id, stage: conv.stage }).from(conv)
    .where(and(inArray(conv.status, ["queued", "processing"]), lt(conv.updatedAt, new Date(Date.now() - STUCK_MIN * 60_000)), isNull(conv.deletedAt))).limit(100);
  for (const c of stuck) {
    const [a] = await db.select({ id: analyses.id }).from(analyses).where(and(eq(analyses.conversationId, c.id), eq(analyses.status, "running"))).orderBy(sql`${analyses.startedAt} desc`).limit(1);
    if (!a) continue;
    const code: FailureCode = c.stage === "transcribing" ? "transcription_failed" : c.stage === "analyzing" ? "analysis_failed" : "audio_unreachable";
    log.warn("stuck conversation failed by sweeper", { conversationId: c.id, stage: c.stage });
    await failRun(c.id, a.id, code, `No progress for ${STUCK_MIN} minutes`, true);
  }
  await disableFailingWebhooks();
  await db.delete(schema.rateLimits).where(lt(schema.rateLimits.windowStart, new Date(Date.now() - 3600_000)));

  const orgs = await db.select({ id: schema.organizations.id, days: schema.organizations.retentionDays }).from(schema.organizations);
  for (const o of orgs.filter((x) => x.days)) {
    const old = await db.select({ id: conv.id, orgId: conv.orgId }).from(conv)
      .where(and(eq(conv.orgId, o.id), isNull(conv.deletedAt), lt(conv.occurredAt, new Date(Date.now() - o.days! * 86400_000)))).limit(200);
    const { eraseConversation } = await import("@/server/services/conversations");
    for (const c of old) await eraseConversation(c);
    if (old.length) log.info("retention erased conversations", { orgId: o.id, count: old.length });
  }
}

export type { QueueName };
