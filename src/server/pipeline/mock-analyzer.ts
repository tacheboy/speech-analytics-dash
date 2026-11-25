import type { CallTemplate } from "@/lib/domain";
import { loadTemplates, loadTimings } from "@/server/content";
import { computeMetrics } from "@/server/metrics";
import { criterionApplicability, evaluateTags } from "@/server/targeting";
import type { AnalysisResult, Analyzer } from "./analyzer";

let cache: { templates: Map<string, CallTemplate>; timings: ReturnType<typeof loadTimings> } | null = null;
export function content() {
  cache ??= { templates: new Map(loadTemplates().map((t) => [t.id, t])), timings: loadTimings() };
  return cache;
}

/** Replays a pre-authored analysis for a scripted call — stands in for ASR + LLM scoring. */
export const mockAnalyzer: Analyzer = {
  analyze({ rubric, templateId }): AnalysisResult {
    const { templates, timings } = content();
    const t = templates.get(templateId);
    const tm = timings[templateId];
    if (!t || !tm) throw new Error(`template ${templateId} has no content/audio`);
    const transcript = t.lines.map((l, i) => ({
      start: tm.segments[i].start,
      end: tm.segments[i].end,
      speaker: l.speaker,
      lang: l.lang,
      text: l.text,
      ...(l.roman ? { roman: l.roman } : {}),
    }));
    const a = t.analysis;
    const outcome = rubric.outcomes.find((o) => o.id === a.outcomeId)!;
    const ctx = { outcome, extractions: a.extractions };
    // NA outcome: the whole call is excluded, no criteria are scored
    const applicability = outcome.isNotApplicable ? [] : criterionApplicability(rubric, ctx);
    const criteria = applicability.map(({ sectionId, criterionId, naReason }) => {
      if (naReason) return { sectionId, criterionId, result: "na" as const, rationale: `Not applicable: ${naReason}.`, evidenceQuote: null, evidenceStart: null, confidence: 1, naReason };
      const r = a.criteria[criterionId] ?? { result: "na" as const, line: null, rationale: "Not enough information in the call to judge.", confidence: 0.5 };
      const seg = r.line != null ? transcript[r.line] : null;
      return {
        sectionId, criterionId, result: r.result, rationale: r.rationale,
        evidenceQuote: seg ? seg.text : null, evidenceStart: seg ? seg.start : null, confidence: r.confidence,
        naReason: r.result === "na" ? "Not enough information in the call" : null,
      };
    });
    const answers = Object.fromEntries(criteria.map((c) => [c.criterionId, c.result]));
    const tags = evaluateTags(rubric, { ...ctx, criteria: answers });
    return {
      transcript,
      durationSec: Math.round(tm.duration),
      outcomeId: a.outcomeId,
      outcomeRationale: a.outcomeRationale,
      summary: a.summary,
      observations: a.observations,
      improvements: a.improvements,
      extractions: a.extractions,
      moments: a.moments.map((m) => ({ type: m.type, label: m.label, start: transcript[m.line].start })),
      metrics: computeMetrics(transcript, tm.duration),
      tags,
      criteria,
    };
  },
};
