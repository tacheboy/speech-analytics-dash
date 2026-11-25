import { and, eq, inArray } from "drizzle-orm";
import type { CallMetrics, CriterionResultValue, Moment, Rubric, TranscriptSegment } from "@/lib/domain";
import { db, schema } from "@/server/db/client";
import { emitEvent } from "@/server/events";
import { computeMetrics } from "@/server/metrics";
import { rubricAt } from "@/server/rubrics";
import { callScore } from "@/server/scoring";
import { criterionApplicability, evaluateTags } from "@/server/targeting";
import { verifyEvidence, type LlmAnalysis } from "../prompt";
import type { StageJob } from "../queue";
import { loadRun, StageError } from "./common";

const { conversations, criterionResults, conversationTags, tags, analyses } = schema;
export const INSUFFICIENT = "Not enough information in the call";

export type CriterionOut = {
  sectionId: string; criterionId: string; result: CriterionResultValue; source: "ai" | "rule";
  rationale: string; evidenceQuote: string | null; evidenceStart: number | null; evidenceEnd: number | null; evidenceVerified: boolean | null;
  confidence: number; naReason: string | null;
};

/**
 * Pure: model output + rubric + transcript → what we store. Targeting rules run here, after the model,
 * so rule-driven NA is deterministic and auditable. Unverified evidence keeps the model's answer but
 * caps confidence at 0.5 (those land in the Audits "low confidence" queue).
 */
export function finalizeAnalysis(rubric: Rubric, a: LlmAnalysis, transcript: TranscriptSegment[], durationSec: number) {
  const outcome = rubric.outcomes.find((o) => o.id === a.outcome.id) ?? rubric.outcomes[0];
  const ctx = { outcome, extractions: a.extractions };
  // an NA outcome excludes the whole conversation: nothing is scored
  const applicability = outcome.isNotApplicable ? [] : criterionApplicability(rubric, ctx);
  const criteria: CriterionOut[] = applicability.map(({ sectionId, criterionId, naReason }) => {
    if (naReason) return { sectionId, criterionId, result: "na", source: "rule", rationale: `Not applicable: ${naReason}.`, evidenceQuote: null, evidenceStart: null, evidenceEnd: null, evidenceVerified: null, confidence: 1, naReason };
    const c = a.criteria[criterionId];
    if (!c || c.result === "na") return { sectionId, criterionId, result: "na", source: "ai", rationale: c?.rationale || "Not enough information in the call to judge.", evidenceQuote: null, evidenceStart: null, evidenceEnd: null, evidenceVerified: null, confidence: c?.confidence ?? 0.5, naReason: INSUFFICIENT };
    const v = verifyEvidence(c, transcript);
    return {
      sectionId, criterionId, result: c.result === "yes" ? "pass" : "fail", source: "ai", rationale: c.rationale,
      evidenceQuote: c.evidenceQuote, evidenceStart: v.segment?.start ?? null, evidenceEnd: v.segment?.end ?? null, evidenceVerified: v.verified,
      confidence: v.verified ? c.confidence : Math.min(c.confidence, 0.5), naReason: null,
    };
  });
  const answers = Object.fromEntries(criteria.map((c) => [c.criterionId, c.result]));
  const tagSlugs = evaluateTags(rubric, { ...ctx, criteria: answers });
  const moments: Moment[] = a.moments.filter((m) => transcript[m.line]).map((m) => ({ type: m.type, label: m.label, start: transcript[m.line].start }));
  const metrics: CallMetrics = computeMetrics(transcript, durationSec);
  const score = callScore(criteria.map((c) => ({ sectionId: c.sectionId, finalResult: c.result })));
  return {
    outcome, criteria, tagSlugs, moments, metrics, score,
    riskFlag: criteria.some((c) => c.sectionId === "compliance" && c.result === "fail"),
    text: { summary: a.summary, observations: a.observations, improvements: a.improvements, outcomeRationale: a.outcome.rationale },
    extractions: a.extractions,
  };
}
export type Finalized = ReturnType<typeof finalizeAnalysis>;

/** Writes a finalized analysis in one transaction. Audit overrides on criteria that still exist survive a re-analysis. */
export async function persistAnalysis(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], conv: { id: string; orgId: string }, f: Finalized) {
  const previous = await tx.select({ criterionId: criterionResults.criterionId, overrideResult: criterionResults.overrideResult }).from(criterionResults).where(eq(criterionResults.conversationId, conv.id));
  const overrides = new Map(previous.filter((p) => p.overrideResult).map((p) => [p.criterionId, p.overrideResult!]));
  await tx.delete(criterionResults).where(eq(criterionResults.conversationId, conv.id));
  const rows = f.criteria.map((c) => ({
    conversationId: conv.id, sectionId: c.sectionId, criterionId: c.criterionId, aiResult: c.result, source: c.source,
    overrideResult: overrides.get(c.criterionId) ?? null, finalResult: overrides.get(c.criterionId) ?? c.result,
    rationale: c.rationale, evidenceQuote: c.evidenceQuote, evidenceStart: c.evidenceStart, evidenceEnd: c.evidenceEnd,
    evidenceVerified: c.evidenceVerified, confidence: c.confidence, naReason: c.naReason,
  }));
  if (rows.length) await tx.insert(criterionResults).values(rows);
  await tx.delete(conversationTags).where(and(eq(conversationTags.conversationId, conv.id), eq(conversationTags.source, "rule")));
  if (f.tagSlugs.length) {
    const tagRows = await tx.select({ id: tags.id }).from(tags).where(and(eq(tags.orgId, conv.orgId), inArray(tags.slug, f.tagSlugs)));
    if (tagRows.length) await tx.insert(conversationTags).values(tagRows.map((t) => ({ conversationId: conv.id, tagId: t.id, source: "rule" as const }))).onConflictDoNothing();
  }
  const finalScore = callScore(rows);
  return {
    score: finalScore, aiScore: f.score, outcomeId: f.outcome.id, isSuccess: f.outcome.isSuccess, isNotApplicable: f.outcome.isNotApplicable,
    riskFlag: rows.some((r) => r.sectionId === "compliance" && r.finalResult === "fail"),
    ...f.text, extractions: f.extractions, metrics: f.metrics, moments: f.moments,
  };
}

/** Stage 5: apply rules, score, persist, emit. Reads the model output saved by analyze, so a crash here never re-bills the LLM. */
export async function finalize(job: StageJob) {
  const run = await loadRun(job.conversationId, job.analysisId);
  if (!run) return;
  const { conv, analysis } = run;
  if (!analysis.rawOutput) throw new StageError("analysis_failed", "No model output to finalize", true);
  const [cat] = await db.select().from(schema.categories).where(eq(schema.categories.id, conv.categoryId));
  const rubric = (await rubricAt(conv.categoryId, analysis.rubricVersion)) ?? cat.rubric;
  const f = finalizeAnalysis(rubric, analysis.rawOutput as LlmAnalysis, conv.transcript ?? [], conv.durationSec);
  const reanalysis = Boolean(conv.currentAnalysisId);
  await db.transaction(async (tx) => {
    const patch = await persistAnalysis(tx, conv, f);
    const now = new Date();
    await tx.update(conversations).set({
      ...patch, status: "completed", stage: null, rubricVersion: analysis.rubricVersion, currentAnalysisId: analysis.id,
      failureCode: null, failureMessage: null, failureStage: null, failureRetryable: null, completedAt: now, updatedAt: now,
    }).where(eq(conversations.id, conv.id));
    await tx.update(analyses).set({ status: "completed", completedAt: now }).where(eq(analyses.id, analysis.id));
    await emitEvent(tx, { orgId: conv.orgId, type: reanalysis ? "conversation.updated" : "conversation.completed", conversationId: conv.id });
  });
}
