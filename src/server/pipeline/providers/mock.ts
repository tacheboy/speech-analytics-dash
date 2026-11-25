import { createHash } from "node:crypto";
import type { CallTemplate, TranscriptSegment } from "@/lib/domain";
import { loadTemplates, loadTimings } from "@/server/content";
import type { LlmAnalysis } from "../prompt";
import type { Asr, Llm } from "./types";

/**
 * Keyless providers that replay the 28 scripted conversations in content/call-templates.
 * They run through the real stages (attribution aside), so tests, CI and demos exercise the real pipeline.
 * - mock ASR: the bundled sample's script, or (for any other audio) a script from the same category.
 * - mock LLM: recognises a scripted transcript and returns its authored analysis; anything else gets an
 *   honest "no LLM configured" analysis with every criterion NA.
 */
let cache: { templates: Map<string, CallTemplate>; timings: ReturnType<typeof loadTimings> } | null = null;
export function content() {
  cache ??= { templates: new Map(loadTemplates().map((t) => [t.id, t])), timings: loadTimings() };
  return cache;
}

export function sampleExists(id: string) {
  const { templates, timings } = content();
  const t = templates.get(id);
  return t && timings[t.id] ? { categoryId: t.categoryId, language: t.language } : null;
}

export function templateSegments(t: CallTemplate): TranscriptSegment[] {
  const tm = content().timings[t.id];
  return t.lines.map((l, i) => ({ start: tm.segments[i].start, end: tm.segments[i].end, speaker: l.speaker, lang: l.lang, text: l.text, ...(l.roman ? { roman: l.roman } : {}) }));
}

function pickTemplate(categoryId: string, seed: string, language?: string | null) {
  const { templates, timings } = content();
  const pool = [...templates.values()].filter((t) => t.categoryId === categoryId && timings[t.id]);
  const same = pool.filter((t) => t.language === language);
  const from = same.length ? same : pool;
  if (!from.length) return null;
  const n = createHash("sha256").update(seed).digest().readUInt32BE(0);
  return from[n % from.length];
}

export const mockAsr: Asr = {
  id: "mock:replay",
  supports: { keyterms: false, diarization: true },
  async submit(_audio, opts) {
    const { templates, timings } = content();
    const t = (opts.mock?.sampleId && templates.get(opts.mock.sampleId)) || (opts.mock ? pickTemplate(opts.mock.categoryId, opts.mock.seed, opts.language) : null);
    if (!t) return { done: { units: [] } };
    const segments = templateSegments(t);
    return { done: { units: segments.map((s) => ({ start: s.start, end: s.end, text: s.text, speaker: s.speaker })), segments, durationSec: timings[t.id].duration } };
  },
  async poll() {
    throw new Error("mock ASR is synchronous");
  },
};

/** Which scripted conversation this transcript is, if any (the mock LLM's only "understanding"). */
function recognise(input: string) {
  for (const t of content().templates.values()) if (t.lines.length && input.includes(t.lines[0].text) && input.includes(t.lines.at(-1)!.text)) return t;
  return null;
}

export const mockLlm: Llm = {
  id: "mock:replay",
  supports: { strictJson: true, batch: false },
  async generate({ input, schema }) {
    const props = (schema as { properties: Record<string, { required?: string[]; properties?: Record<string, { enum?: string[] }> }> }).properties;
    const criterionIds = props.criteria.required ?? [];
    const outcomeIds = props.outcome.properties?.id.enum ?? [];
    const fields = props.extractions.required ?? [];
    const t = recognise(input);
    const usage = { input: Math.round(input.length / 4), cachedInput: 0, output: 800 };
    if (!t) {
      const json: LlmAnalysis = {
        criteria: Object.fromEntries(criterionIds.map((id) => [id, { result: "na", evidenceLine: null, evidenceQuote: null, rationale: "No LLM provider is configured, so this conversation was not evaluated.", confidence: 0 }])),
        outcome: { id: outcomeIds.at(-1) ?? outcomeIds[0], rationale: "No LLM provider is configured." },
        extractions: Object.fromEntries(fields.map((f) => [f, null])),
        summary: "Transcribed, but not analysed: no LLM provider is configured. Add an API key (see .env.example) and re-run the analysis.",
        observations: "", improvements: "", moments: [],
      };
      return { json, usage };
    }
    return { json: templateAnalysis(t, criterionIds, outcomeIds, fields), usage };
  },
};

/** The authored analysis of a scripted conversation, in the LLM's output shape. */
export function templateAnalysis(t: CallTemplate, criterionIds: string[], outcomeIds: string[], fields: string[]): LlmAnalysis {
  const a = t.analysis;
  const quote = (line: number | null) => (line == null ? null : t.lines[line]?.text.split(/\s+/).slice(0, 20).join(" ") ?? null);
  // whole-call judgements have no single line in the scripts; like the prompt asks, cite where it should have happened
  const opening = Math.max(0, t.lines.findIndex((l) => l.speaker === "agent"));
  return {
    criteria: Object.fromEntries(criterionIds.map((id) => {
      const c = a.criteria[id];
      if (!c) return [id, { result: "na", evidenceLine: null, evidenceQuote: null, rationale: "Not enough information in the call to judge.", confidence: 0.5 }];
      const result = c.result === "pass" ? "yes" : c.result === "fail" ? "no" : "na";
      const line = c.line ?? opening;
      return [id, { result, evidenceLine: result === "na" ? null : line, evidenceQuote: result === "na" ? null : quote(line), rationale: c.rationale, confidence: c.confidence }];
    })),
    outcome: { id: outcomeIds.includes(a.outcomeId) ? a.outcomeId : outcomeIds[0], rationale: a.outcomeRationale },
    extractions: Object.fromEntries(fields.map((f) => [f, a.extractions[f] ?? null])),
    summary: a.summary, observations: a.observations, improvements: a.improvements,
    moments: a.moments.map((m) => ({ type: m.type, line: m.line, label: m.label })),
  };
}
