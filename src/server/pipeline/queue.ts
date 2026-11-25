import { PgBoss } from "pg-boss";
import { log } from "@/server/log";

/**
 * pg-boss queues, inside the same Postgres. One queue per stage, each with its own retry policy and
 * concurrency, so a slow provider backs up its own queue and nothing else.
 */
export type StageName = "ingest" | "prepare" | "transcribe" | "analyze" | "finalize";
export type StageJob = { conversationId: string; analysisId: string; asrJob?: { ref: string; provider: string; polls: number } };
export type DeliveryJob = { eventId: string; webhookId: string; event: string };

const n = (k: string, d: number) => Number(process.env[k] ?? d);

export const QUEUES = {
  ingest: { retryLimit: 3, retryDelay: 10, retryBackoff: true, expireInSeconds: 15 * 60, concurrency: () => n("INGEST_CONCURRENCY", 4) },
  prepare: { retryLimit: 2, retryDelay: 10, retryBackoff: true, expireInSeconds: 15 * 60, concurrency: () => n("PREPARE_CONCURRENCY", 2) },
  transcribe: { retryLimit: 4, retryDelay: 15, retryBackoff: true, expireInSeconds: 20 * 60, concurrency: () => n("ASR_CONCURRENCY", 8) },
  analyze: { retryLimit: 3, retryDelay: 20, retryBackoff: true, expireInSeconds: 15 * 60, concurrency: () => n("LLM_CONCURRENCY", 4) },
  finalize: { retryLimit: 3, retryDelay: 5, retryBackoff: true, expireInSeconds: 5 * 60, concurrency: () => n("FINALIZE_CONCURRENCY", 4) },
  webhook: { retryLimit: 7, retryDelay: 60, retryBackoff: true, retryDelayMax: 4 * 3600, expireInSeconds: 2 * 60, concurrency: () => n("WEBHOOK_CONCURRENCY", 8) },
} as const;
export type QueueName = keyof typeof QUEUES;

const g = globalThis as unknown as { boss?: Promise<PgBoss> };

/** One pg-boss instance per process (survives dev hot reloads). Queues are created on first use. */
export function boss(): Promise<PgBoss> {
  g.boss ??= (async () => {
    const b = new PgBoss({ connectionString: process.env.DATABASE_URL!, max: n("QUEUE_POOL_SIZE", 5), application_name: "insights-queue" });
    b.on("error", (e) => log.error("queue error", { err: e }));
    await b.start();
    for (const [name, q] of Object.entries(QUEUES)) {
      const { concurrency: _c, ...opts } = q;
      if (!(await b.getQueue(name))) await b.createQueue(name, { ...opts, deleteAfterSeconds: 7 * 86400 });
    }
    return b;
  })().catch((e) => {
    g.boss = undefined;
    throw e;
  });
  return g.boss;
}

export async function enqueueStage(stage: StageName, data: StageJob, opts: { startAfter?: number } = {}) {
  await (await boss()).send(stage, data, opts.startAfter ? { startAfter: opts.startAfter } : undefined);
}

export async function enqueueDelivery(data: DeliveryJob) {
  await (await boss()).send("webhook", data);
}

export async function stopQueue() {
  if (!g.boss) return;
  const b = await g.boss;
  g.boss = undefined;
  await b.stop({ graceful: true, timeout: 10_000 });
}
