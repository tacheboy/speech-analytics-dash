import { z } from "zod";
import { MOMENT_TYPES, type Rubric, type TranscriptSegment } from "@/lib/domain";
import type { JsonSchema } from "./providers/types";

/**
 * Rubric → (system prompt, JSON schema) and transcript → numbered lines. One prompt for every provider:
 * plain text, no vendor-specific tricks. The schema stays inside the subset every strict mode accepts
 * (all fields required, additionalProperties false, enums, anyOf-with-null for optional values).
 * Bump PROMPT_VERSION whenever the prompt or schema changes; it's stored on every analysis.
 */
export const PROMPT_VERSION = "2026-11-25.1";

export type LlmCriterion = { result: "yes" | "no" | "na"; evidenceLine: number | null; evidenceQuote: string | null; rationale: string; confidence: number };
export type LlmAnalysis = {
  criteria: Record<string, LlmCriterion>;
  outcome: { id: string; rationale: string };
  extractions: Record<string, string | number | boolean | null>;
  summary: string;
  observations: string;
  improvements: string;
  moments: { type: (typeof MOMENT_TYPES)[number]; line: number; label: string }[];
};

const nullable = (s: JsonSchema): JsonSchema => ({ anyOf: [s, { type: "null" }] });

function fieldSchema(f: Rubric["extractionFields"][number]): JsonSchema {
  const description = f.description;
  if (f.fieldType === "enum" && f.enumOptions?.length) return nullable({ type: "string", enum: f.enumOptions.map((o) => o.value), description });
  if (f.fieldType === "number") return nullable({ type: "number", description });
  if (f.fieldType === "boolean") return nullable({ type: "boolean", description });
  return nullable({ type: "string", description });
}

export function analysisJsonSchema(rubric: Rubric): JsonSchema {
  const criteria = rubric.sections.flatMap((s) => s.criteria);
  const criterion: JsonSchema = {
    type: "object",
    additionalProperties: false,
    required: ["result", "evidenceLine", "evidenceQuote", "rationale", "confidence"],
    properties: {
      result: { type: "string", enum: ["yes", "no", "na"] },
      evidenceLine: nullable({ type: "integer", description: "Line number [n] of the transcript that proves the answer" }),
      evidenceQuote: nullable({ type: "string", description: "Exact words copied from that line" }),
      rationale: { type: "string" },
      confidence: { type: "number", description: "0 to 1" },
    },
  };
  return {
    type: "object",
    additionalProperties: false,
    required: ["criteria", "outcome", "extractions", "summary", "observations", "improvements", "moments"],
    properties: {
      criteria: { type: "object", additionalProperties: false, required: criteria.map((c) => c.id), properties: Object.fromEntries(criteria.map((c) => [c.id, criterion])) },
      outcome: {
        type: "object", additionalProperties: false, required: ["id", "rationale"],
        properties: { id: { type: "string", enum: rubric.outcomes.map((o) => o.id) }, rationale: { type: "string" } },
      },
      extractions: {
        type: "object", additionalProperties: false, required: rubric.extractionFields.map((f) => f.fieldName),
        properties: Object.fromEntries(rubric.extractionFields.map((f) => [f.fieldName, fieldSchema(f)])),
      },
      summary: { type: "string" },
      observations: { type: "string" },
      improvements: { type: "string" },
      moments: {
        type: "array",
        items: {
          type: "object", additionalProperties: false, required: ["type", "line", "label"],
          properties: { type: { type: "string", enum: [...MOMENT_TYPES] }, line: { type: "integer" }, label: { type: "string" } },
        },
      },
    },
  };
}

/** The same shape as a zod schema, to validate whatever a provider returns (strict or not). */
export function analysisZod(rubric: Rubric) {
  const criteria = rubric.sections.flatMap((s) => s.criteria);
  const crit = z.object({
    result: z.enum(["yes", "no", "na"]),
    evidenceLine: z.number().int().nullable(),
    evidenceQuote: z.string().nullable(),
    rationale: z.string(),
    confidence: z.number().transform((n) => Math.min(1, Math.max(0, n))),
  });
  const base = (f: Rubric["extractionFields"][number]): z.ZodType =>
    f.fieldType === "enum" && f.enumOptions?.length ? z.enum(f.enumOptions.map((o) => o.value) as [string, ...string[]])
      : f.fieldType === "number" ? z.number()
        : f.fieldType === "boolean" ? z.boolean()
          : z.string();
  const field = (f: Rubric["extractionFields"][number]) => base(f).nullable().default(null);
  return z.object({
    criteria: z.object(Object.fromEntries(criteria.map((c) => [c.id, crit]))),
    outcome: z.object({ id: z.enum(rubric.outcomes.map((o) => o.id) as [string, ...string[]]), rationale: z.string() }),
    extractions: z.object(Object.fromEntries(rubric.extractionFields.map((f) => [f.fieldName, field(f)]))),
    summary: z.string(),
    observations: z.string(),
    improvements: z.string(),
    moments: z.array(z.object({ type: z.enum(MOMENT_TYPES), line: z.number().int(), label: z.string() })).default([]),
  });
}

const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** `[12 P 02:14] text` — P is the person being evaluated, C the customer. */
export const transcriptLines = (t: TranscriptSegment[]) =>
  t.map((s, i) => `[${i} ${s.speaker === "agent" ? "P" : "C"} ${clock(s.start)}] ${s.text}`).join("\n");

export function buildSystemPrompt(rubric: Rubric) {
  const sections = rubric.sections
    .map((s) => `### ${s.name}\n${s.criteria.map((c) => `- ${c.id}: ${c.question}${c.context ? `\n  Guidance: ${c.context}` : ""}`).join("\n")}`)
    .join("\n\n");
  const outcomes = rubric.outcomes.map((o) => `- ${o.id} (${o.isNotApplicable ? "not applicable: excluded from scoring" : o.isSuccess ? "success" : "standard"}): ${o.label}. ${o.description}`).join("\n");
  const fields = rubric.extractionFields
    .map((f) => `- ${f.fieldName} (${f.fieldType}${f.enumOptions?.length ? `: ${f.enumOptions.map((o) => `${o.value}${o.hint ? ` = ${o.hint}` : ""}`).join(", ")}` : ""}): ${f.description}`)
    .join("\n");
  return `You are a senior quality auditor for a contact centre. You evaluate one recorded conversation against the rubric below and return a single JSON object.

The transcript can mix English with Indian languages (Tamil, Kannada, Hindi and others) in native script or romanised form. Judge meaning, not language. Each transcript line looks like "[n S mm:ss] text", where n is the line number, S is P (the person being evaluated: the agent) or C (the customer).

## How to answer each rubric criterion
- "yes": the person clearly did it. "no": they clearly did not, or did it in a way the criterion forbids. "na": the conversation gives no basis to judge (it never got that far, or the topic never came up).
- For every "yes" or "no", set evidenceLine to the line number that proves it and copy evidenceQuote verbatim from that line (a short exact phrase, 3–20 words, same script as the line). Your quote is checked against the transcript; paraphrases fail.
- For a "no" that is about something never said, cite the line where it should have happened and quote it.
- For "na", evidenceLine and evidenceQuote are null.
- rationale: one or two sentences, specific to this conversation. confidence: 0–1.
- Don't decide which criteria apply based on business rules; the system applies those afterwards. Answer every criterion on what happened.

## Purpose of this conversation type
${rubric.intendedPurpose}
${rubric.additionalLLMContext ? `\n## Additional context\n${rubric.additionalLLMContext}\n` : ""}
## Rubric
${sections}

## Outcomes (pick exactly one)
${outcomes}

## Data to extract (null when the conversation doesn't say)
${fields || "(none)"}

## Also write
- summary: 2–4 sentences on what happened, in English.
- observations: what went well and what didn't, in English.
- improvements: concrete coaching for the person, in English.
- moments: notable points (${MOMENT_TYPES.join(", ")}) with the line number and a short English label.`;
}

export function buildInput(transcript: TranscriptSegment[], ctx: { metadata?: Record<string, unknown> | null; language?: string | null; feedback?: string }) {
  const meta = ctx.metadata && Object.keys(ctx.metadata).length ? `Call metadata: ${JSON.stringify(ctx.metadata)}\n` : "";
  const lang = ctx.language ? `Expected language: ${ctx.language}\n` : "";
  const fb = ctx.feedback ? `\n\nYour previous answer had problems. Fix them and return the full JSON again:\n${ctx.feedback}` : "";
  return `${meta}${lang}Transcript:\n${transcriptLines(transcript)}${fb}`;
}

/* ---------------- evidence verification (deterministic, ours) ---------------- */

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);

/** Share of the quote's tokens that appear in the text (order-insensitive, multiset). */
export function tokenOverlap(quote: string, text: string) {
  const q = norm(quote);
  if (!q.length) return 0;
  const pool = new Map<string, number>();
  for (const t of norm(text)) pool.set(t, (pool.get(t) ?? 0) + 1);
  let hit = 0;
  for (const t of q) {
    const n = pool.get(t) ?? 0;
    if (n > 0) {
      hit++;
      pool.set(t, n - 1);
    }
  }
  return hit / q.length;
}

/** A Yes/No answer is verified when its quote matches the cited line (±1, native or romanised) at ≥ 0.85 token overlap. */
export function verifyEvidence(a: Pick<LlmCriterion, "result" | "evidenceLine" | "evidenceQuote">, transcript: TranscriptSegment[]) {
  if (a.result === "na") return { verified: true, segment: null as TranscriptSegment | null };
  if (a.evidenceLine == null || !a.evidenceQuote?.trim()) return { verified: false, segment: null };
  const line = transcript[a.evidenceLine];
  if (!line) return { verified: false, segment: null };
  for (const i of [a.evidenceLine, a.evidenceLine - 1, a.evidenceLine + 1]) {
    const s = transcript[i];
    if (s && Math.max(tokenOverlap(a.evidenceQuote, s.text), s.roman ? tokenOverlap(a.evidenceQuote, s.roman) : 0) >= 0.85) return { verified: true, segment: s };
  }
  return { verified: false, segment: line };
}

export function evidenceProblems(a: LlmAnalysis, transcript: TranscriptSegment[]) {
  return Object.entries(a.criteria)
    .filter(([, c]) => !verifyEvidence(c, transcript).verified)
    .map(([id, c]) => `- ${id}: answer "${c.result}" cites line ${c.evidenceLine ?? "(none)"} with quote ${JSON.stringify(c.evidenceQuote)}, which is not in that line. Quote the exact words, or answer "na" if there is no evidence.`);
}
