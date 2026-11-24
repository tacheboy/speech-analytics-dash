import type { CallTemplate } from "@/lib/domain";
import { loadTemplates, loadTimings } from "@/server/content";
import { computeMetrics } from "@/server/metrics";
import { applicableSections } from "@/server/targeting";
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
    const sections = outcome.isNotApplicable ? [] : applicableSections(rubric, { outcome, extractions: a.extractions });
    const criteria = sections.flatMap((s) =>
      s.criteria.map((c) => {
        const r = a.criteria[c.id] ?? { result: "na" as const, line: null, rationale: "Not assessed.", confidence: 0.5 };
        const seg = r.line != null ? transcript[r.line] : null;
        return {
          sectionId: s.id,
          criterionId: c.id,
          result: r.result,
          rationale: r.rationale,
          evidenceQuote: seg ? seg.text : null,
          evidenceStart: seg ? seg.start : null,
          confidence: r.confidence,
        };
      }),
    );
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
      criteria,
    };
  },
};
