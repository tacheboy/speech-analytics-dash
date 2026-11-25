import { eq } from "drizzle-orm";
import type { Rubric, TranscriptSegment } from "@/lib/domain";
import { db, schema } from "@/server/db/client";
import { log } from "@/server/log";
import { scorecardOf } from "@/server/presenters/conversation";
import { rubricAt } from "@/server/rubrics";
import { analysisJsonSchema, analysisZod, buildInput, buildSystemPrompt, evidenceProblems, PROMPT_VERSION, type LlmAnalysis } from "../prompt";
import { llmCostMicros } from "../providers/prices";
import { providers } from "../providers/registry";
import { ProviderError, type Llm, type Usage } from "../providers/types";
import { enqueueStage, type StageJob } from "../queue";
import { finalizeAnalysis } from "./finalize";
import { loadRun, setStage, StageError, type StageCtx } from "./common";

const MAX_OUTPUT_TOKENS = Number(process.env.LLM_MAX_OUTPUT_TOKENS ?? 16000);

export type LlmRun = { analysis: LlmAnalysis; usage: Usage; model: string; usedFallback: boolean; repaired: boolean; unverified: number };

/**
 * One structured generation per conversation, validated by zod and checked against the transcript.
 * Invalid output or unverified evidence gets exactly one repair request listing the problems; the
 * better of the two answers is kept. A retryable provider failure on the final attempt switches to
 * LLM_FALLBACK when one is configured.
 */
export async function runLlm(rubric: Rubric, transcript: TranscriptSegment[], ctx: { metadata?: Record<string, unknown> | null; language?: string | null; allowFallback: boolean; llm?: Llm }): Promise<LlmRun> {
  const { llm: configured, llmFallback } = ctx.llm ? { llm: ctx.llm, llmFallback: null } : providers();
  const llm = configured;
  try {
    return await runWith(llm, rubric, transcript, ctx, false);
  } catch (e) {
    if (e instanceof ProviderError && e.retryable && ctx.allowFallback && llmFallback) {
      log.warn("LLM primary failed; using fallback", { primary: llm.id, fallback: llmFallback.id, err: e });
      return runWith(llmFallback, rubric, transcript, ctx, true);
    }
    throw e;
  }
}

async function runWith(llm: Llm, rubric: Rubric, transcript: TranscriptSegment[], ctx: { metadata?: Record<string, unknown> | null; language?: string | null }, usedFallback: boolean): Promise<LlmRun> {
  const schema = analysisJsonSchema(rubric);
  const zod = analysisZod(rubric);
  const system = buildSystemPrompt(rubric);
  const usage: Usage = { input: 0, cachedInput: 0, output: 0 };
  const call = async (feedback?: string) => {
    const res = await llm.generate({ system, input: buildInput(transcript, { ...ctx, feedback }), schema, schemaName: "conversation_analysis", maxOutputTokens: MAX_OUTPUT_TOKENS });
    usage.input += res.usage.input;
    usage.cachedInput += res.usage.cachedInput;
    usage.output += res.usage.output;
    const parsed = zod.safeParse(res.json);
    if (!parsed.success) return { ok: false as const, problems: parsed.error.issues.slice(0, 20).map((i) => `- ${i.path.join(".")}: ${i.message}`) };
    const analysis = parsed.data as LlmAnalysis;
    return { ok: true as const, analysis, problems: evidenceProblems(analysis, transcript) };
  };

  const first = await call();
  if (first.ok && !first.problems.length) return { analysis: first.analysis, usage, model: llm.id, usedFallback, repaired: false, unverified: 0 };
  const second = await call(first.problems.join("\n"));
  const best = [first, second].filter((x) => x.ok).sort((a, b) => a.problems.length - b.problems.length)[0];
  if (!best?.ok) throw new ProviderError(`Model output didn't match the schema after one repair: ${second.problems.slice(0, 3).join(" ")}`, true);
  return { analysis: best.analysis, usage, model: llm.id, usedFallback, repaired: true, unverified: best.problems.length };
}

/** Stage 4: run the LLM and save its validated output + usage on the analysis row; finalize does the rest. */
export async function analyze(job: StageJob, ctx: StageCtx) {
  const run = await loadRun(job.conversationId, job.analysisId);
  if (!run) return;
  const { conv, analysis } = run;
  await setStage(conv, "analyzing");
  if (!analysis.rawOutput) {
    if (!conv.transcript?.length) throw new StageError("analysis_failed", "No transcript to analyse", false);
    const [cat] = await db.select().from(schema.categories).where(eq(schema.categories.id, conv.categoryId));
    const rubric = (await rubricAt(conv.categoryId, analysis.rubricVersion)) ?? cat.rubric;
    let r: LlmRun;
    try {
      r = await runLlm(rubric, conv.transcript, { metadata: conv.metadata, language: conv.language, allowFallback: ctx.lastAttempt });
    } catch (e) {
      if (e instanceof ProviderError) throw new StageError("analysis_failed", e.message, e.retryable);
      throw e;
    }
    await db.update(schema.analyses).set({
      rawOutput: r.analysis, llmModel: r.model, usedFallback: r.usedFallback, repaired: r.repaired, promptVersion: PROMPT_VERSION,
      inputTokens: r.usage.input, cachedTokens: r.usage.cachedInput, outputTokens: r.usage.output, costMicrosUsd: llmCostMicros(r.model, r.usage),
    }).where(eq(schema.analyses.id, analysis.id));
    log.info("analysed", { conversationId: conv.id, model: r.model, repaired: r.repaired, unverified: r.unverified, tokensIn: r.usage.input, tokensOut: r.usage.output });
  }
  await enqueueStage("finalize", job);
}

/** POST /conversations/{id}/analyze with dryRun: score against a (draft) rubric and return the result without saving. */
export async function dryRunAnalysis(conv: typeof schema.conversations.$inferSelect, rubric: Rubric, origin: string) {
  void origin;
  let r: LlmRun;
  try {
    r = await runLlm(rubric, conv.transcript ?? [], { metadata: conv.metadata, language: conv.language, allowFallback: true });
  } catch (e) {
    if (e instanceof ProviderError) throw new (await import("@/server/auth")).ApiError(502, "analysis_failed", e.message);
    throw e;
  }
  const f = finalizeAnalysis(rubric, r.analysis, conv.transcript ?? [], conv.durationSec);
  const rows = f.criteria.map((c) => ({ ...c, conversationId: conv.id, aiResult: c.result, overrideResult: null, finalResult: c.result }));
  return {
    object: "dry_run" as const,
    conversationId: conv.id,
    score: f.outcome.isNotApplicable ? null : f.score,
    outcome: { id: f.outcome.id, label: f.outcome.label, rationale: f.text.outcomeRationale },
    riskFlag: f.riskFlag,
    scorecard: scorecardOf(rubric, rows as never),
    extractions: f.extractions,
    tags: f.tagSlugs,
    summary: f.text.summary,
    model: r.model,
    usage: r.usage,
    costUsd: (llmCostMicros(r.model, r.usage) ?? 0) / 1e6,
  };
}
