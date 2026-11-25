import type { Rubric } from "@/lib/domain";
import { callScore } from "@/server/scoring";
import type { AnalysisResult } from "./analyzer";

/** Maps an analyzer result to the call columns + criterion rows we store. */
export function toRows(callId: string, rubric: Rubric, r: AnalysisResult) {
  const outcome = rubric.outcomes.find((o) => o.id === r.outcomeId)!;
  const criterionRows = r.criteria.map((c) => ({
    callId,
    sectionId: c.sectionId,
    criterionId: c.criterionId,
    aiResult: c.result,
    overrideResult: null,
    finalResult: c.result,
    rationale: c.rationale,
    evidenceQuote: c.evidenceQuote,
    evidenceStart: c.evidenceStart,
    confidence: c.confidence,
    naReason: c.naReason,
  }));
  const score = callScore(criterionRows);
  return {
    callPatch: {
      status: "done" as const,
      transcript: r.transcript,
      durationSec: r.durationSec,
      score,
      aiScore: score,
      outcomeId: r.outcomeId,
      isSuccess: outcome.isSuccess,
      isNotApplicable: outcome.isNotApplicable,
      complianceFlag: criterionRows.some((c) => c.sectionId === "compliance" && c.finalResult === "fail"),
      summary: r.summary,
      outcomeRationale: r.outcomeRationale,
      observations: r.observations,
      improvements: r.improvements,
      extractions: r.extractions,
      metrics: r.metrics,
      moments: r.moments,
    },
    criterionRows,
    tagSlugs: r.tags,
  };
}
