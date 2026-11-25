import { and, eq } from "drizzle-orm";
import type { FailureCode } from "@/lib/contract";
import { db, schema } from "@/server/db/client";
import { emitEvent } from "@/server/events";
import { log } from "@/server/log";
import { conversationPrefix } from "@/server/storage";

const { conversations, analyses } = schema;
export type ConversationRow = typeof conversations.$inferSelect;
export type AnalysisRow = typeof analyses.$inferSelect;
export type StageCtx = { attempt: number; lastAttempt: boolean };

/** A failure the stage has classified. Non-retryable ones fail the conversation immediately. */
export class StageError extends Error {
  constructor(public code: FailureCode, message: string, public retryable: boolean) {
    super(message);
  }
}

/** Loads the conversation and the analysis run this job belongs to; null when it was superseded or deleted. */
export async function loadRun(conversationId: string, analysisId: string) {
  const [conv] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
  const [analysis] = await db.select().from(analyses).where(eq(analyses.id, analysisId));
  if (!conv || !analysis || conv.deletedAt || analysis.status !== "running") return null;
  return { conv, analysis, prefix: conversationPrefix(conv.orgId, conv.id) };
}

export async function setStage(conv: ConversationRow, stage: "ingesting" | "transcribing" | "analyzing") {
  if (conv.status === "processing" && conv.stage === stage) {
    await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conv.id)); // heartbeat for the stuck sweeper
    return;
  }
  await db.update(conversations).set({ status: "processing", stage, updatedAt: new Date() }).where(eq(conversations.id, conv.id));
}

const STAGE_OF: Record<FailureCode, "ingesting" | "transcribing" | "analyzing"> = {
  audio_unreachable: "ingesting", audio_forbidden: "ingesting", audio_invalid: "ingesting", too_short: "ingesting",
  no_speech: "transcribing", transcription_failed: "transcribing", analysis_failed: "analyzing",
};

/**
 * Ends a run as failed (or skipped, for too_short / no_speech) with a typed reason and emits
 * conversation.failed, in one transaction. Only the current run can fail its conversation.
 */
export async function failRun(conversationId: string, analysisId: string, code: FailureCode, message: string, retryable: boolean) {
  const skipped = code === "too_short" || code === "no_speech";
  await db.transaction(async (tx) => {
    const done = await tx.update(analyses).set({ status: "failed", error: `${code}: ${message}`, completedAt: new Date() })
      .where(and(eq(analyses.id, analysisId), eq(analyses.status, "running"))).returning({ id: analyses.id });
    if (!done.length) return;
    const [conv] = await tx.select({ orgId: conversations.orgId, transcript: conversations.transcript, status: conversations.status, currentAnalysisId: conversations.currentAnalysisId }).from(conversations).where(eq(conversations.id, conversationId));
    if (!conv) return;
    // a failed re-analysis of a completed conversation leaves the previous result in place
    if (conv.currentAnalysisId && code === "analysis_failed") {
      await tx.update(conversations).set({ status: "completed", stage: null, updatedAt: new Date() }).where(eq(conversations.id, conversationId));
      log.warn("re-analysis failed; previous analysis kept", { conversationId, code, message });
      return;
    }
    await tx.update(conversations).set({
      status: skipped ? "skipped" : "failed", stage: null, failureCode: code, failureMessage: message, failureStage: STAGE_OF[code],
      failureRetryable: retryable, completedAt: new Date(), updatedAt: new Date(),
    }).where(eq(conversations.id, conversationId));
    await emitEvent(tx, { orgId: conv.orgId, type: "conversation.failed", conversationId });
  });
  log.info("conversation failed", { conversationId, code, retryable });
}
