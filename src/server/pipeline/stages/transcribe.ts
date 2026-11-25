import { eq } from "drizzle-orm";
import { db, schema } from "@/server/db/client";
import { log } from "@/server/log";
import { computeMetrics } from "@/server/metrics";
import { storage } from "@/server/storage";
import { attributeByDiarization, attributeByEnergy, toSegments } from "../attribute";
import { asrCostMicros } from "../providers/prices";
import { providers } from "../providers/registry";
import { ProviderError, type Asr, type AsrResult } from "../providers/types";
import { enqueueStage, type StageJob } from "../queue";
import { failRun, loadRun, setStage, StageError, type StageCtx } from "./common";

const MAX_POLLS = 240; // ~2 h at the 30 s cap

/**
 * Stage 3: ASR → speaker attribution → segments. Async providers are polled with delayed jobs (no worker
 * slot waits). The raw ASR result is stored (asr.json) before attribution, so a retry never pays twice.
 */
export async function transcribe(job: StageJob, ctx: StageCtx) {
  const run = await loadRun(job.conversationId, job.analysisId);
  if (!run) return;
  const { conv, prefix } = run;
  await setStage(conv, "transcribing");
  const store = await storage();
  const { asr, asrFallback } = providers();

  let stored = await store.get(`${prefix}/asr.json`);
  let result: AsrResult & { provider?: string };
  if (stored) {
    result = JSON.parse(stored.toString());
  } else {
    const provider = job.asrJob && asrFallback && job.asrJob.provider === asrFallback.id ? asrFallback : asr;
    let r: AsrResult | null;
    try {
      r = await transcribeWith(provider, job, conv, prefix);
    } catch (e) {
      if (!(e instanceof ProviderError)) throw e;
      if (!e.retryable) throw new StageError("transcription_failed", e.message, false);
      if (!(ctx.lastAttempt && asrFallback && provider !== asrFallback)) throw e;
      log.warn("ASR primary failed; using fallback", { conversationId: conv.id, err: e });
      r = await transcribeWith(asrFallback, { ...job, asrJob: undefined }, conv, prefix);
    }
    if (!r) return; // still running: a delayed poll job was queued
    result = r;
    stored = Buffer.from(JSON.stringify(result));
    await store.put(`${prefix}/asr.json`, stored, "application/json");
  }

  const units = result.units.filter((u) => u.text.trim());
  if (!units.length) {
    await failRun(conv.id, job.analysisId, "no_speech", "No speech was found in the recording", false);
    return;
  }
  let segments = result.segments;
  if (!segments) {
    const energyBytes = (conv.channels ?? 1) >= 2 && conv.channelLayout !== "mono" ? await store.get(`${prefix}/energy.json`) : null;
    const speakers = energyBytes
      ? attributeByEnergy(units, JSON.parse(energyBytes.toString()), conv.channelLayout === "right" ? "right" : "left")
      : attributeByDiarization(units);
    segments = toSegments(units, speakers, conv.language);
  }
  const metrics = computeMetrics(segments, conv.durationSec);
  const model = result.provider ?? asr.id;
  await db.transaction(async (tx) => {
    await tx.update(schema.conversations).set({ transcript: segments, languageDetected: metrics.languageMix as Record<string, number>, updatedAt: new Date() }).where(eq(schema.conversations.id, conv.id));
    await tx.update(schema.analyses).set({ asrModel: model, audioSeconds: conv.durationSec }).where(eq(schema.analyses.id, job.analysisId));
  });
  log.info("transcribed", { conversationId: conv.id, model, segments: segments.length, asrCostMicros: asrCostMicros(model, conv.durationSec) });
  await enqueueStage("analyze", { conversationId: job.conversationId, analysisId: job.analysisId });
}

/** Submits or polls. Returns the result, or null after scheduling the next poll. */
async function transcribeWith(asr: Asr, job: StageJob, conv: typeof schema.conversations.$inferSelect, prefix: string): Promise<(AsrResult & { provider: string }) | null> {
  const [org] = await db.select({ keyterms: schema.organizations.keyterms }).from(schema.organizations).where(eq(schema.organizations.id, conv.orgId));
  const stereo = (conv.channels ?? 1) >= 2 && conv.channelLayout !== "mono";
  const opts = {
    language: conv.language,
    keyterms: org?.keyterms ?? [],
    diarize: !stereo || asr.supports.diarization, // turns make good attribution units even on stereo
    mock: { sampleId: conv.sampleId, categoryId: conv.categoryId, seed: conv.id },
  };
  if (job.asrJob) {
    const r = await asr.poll({ ref: job.asrJob.ref }, opts);
    if ("done" in r) return { ...r.done, provider: asr.id };
    if (job.asrJob.polls >= MAX_POLLS) throw new StageError("transcription_failed", "Transcription did not finish within 2 hours", true);
    const delay = Math.min(30, 10 + job.asrJob.polls * 5);
    await enqueueStage("transcribe", { ...job, asrJob: { ...job.asrJob, polls: job.asrJob.polls + 1 } }, { startAfter: delay });
    return null;
  }
  const audio = await (await storage()).get(`${prefix}/asr.mp3`);
  if (!audio) throw new StageError("transcription_failed", "The prepared audio is missing", true);
  const r = await asr.submit({ bytes: audio, contentType: "audio/mpeg", fileName: `${conv.id}.mp3` }, opts);
  if ("done" in r) return { ...r.done, provider: asr.id };
  await enqueueStage("transcribe", { ...job, asrJob: { ref: r.ref, provider: asr.id, polls: 1 } }, { startAfter: 10 });
  return null;
}
