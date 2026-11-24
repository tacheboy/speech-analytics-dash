import type { CallMetrics, CriterionResultValue, Moment, Rubric, TranscriptSegment } from "@/lib/domain";

/** What any analyzer (mock today, ASR + LLM later) must produce for a call. */
export type AnalysisResult = {
  transcript: TranscriptSegment[];
  durationSec: number;
  outcomeId: string;
  outcomeRationale: string;
  summary: string;
  observations: string;
  improvements: string;
  extractions: Record<string, string | number | boolean | null>;
  moments: Moment[];
  metrics: CallMetrics;
  criteria: {
    sectionId: string;
    criterionId: string;
    result: CriterionResultValue;
    rationale: string;
    evidenceQuote: string | null;
    evidenceStart: number | null;
    confidence: number;
  }[];
};

export interface Analyzer {
  analyze(input: { rubric: Rubric; templateId: string }): AnalysisResult;
}
