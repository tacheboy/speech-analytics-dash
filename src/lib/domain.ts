import { z } from "zod";

/* ---------- Rubric (category analysis configuration) ---------- */

export const criterionSchema = z.object({
  id: z.string(),
  question: z.string(),
  context: z.string().optional(),
});

export const sectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  criteria: z.array(criterionSchema).min(1),
});

export const outcomeSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  isSuccess: z.boolean().nullable(), // null = standard (neither success nor failure)
  isNotApplicable: z.boolean().default(false),
});

export const extractionFieldSchema = z.object({
  fieldName: z.string(),
  displayName: z.string(),
  fieldType: z.enum(["text", "enum", "number", "boolean"]),
  description: z.string(),
  enumValues: z.array(z.string()).optional(),
});

export const targetingRuleSchema = z.object({
  targetType: z.literal("section"),
  targetId: z.string(),
  description: z.string(),
  expression: z.record(z.string(), z.unknown()), // JSONLogic
});

export const rubricSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  icon: z.string(),
  sections: z.array(sectionSchema),
  outcomes: z.array(outcomeSchema),
  extractionFields: z.array(extractionFieldSchema),
  targetingRules: z.array(targetingRuleSchema),
});

export type Rubric = z.infer<typeof rubricSchema>;
export type Outcome = z.infer<typeof outcomeSchema>;

/* ---------- Transcript + analysis ---------- */

export const LANGS = ["en", "ta", "kn", "hi"] as const;
export type Lang = (typeof LANGS)[number];
export type Speaker = "agent" | "customer";

export type TranscriptSegment = {
  start: number;
  end: number;
  speaker: Speaker;
  lang: Lang;
  text: string;
  roman?: string;
};

export type CriterionResultValue = "pass" | "fail" | "na";

export const MOMENT_TYPES = ["ptp", "objection", "compliance_risk", "dispute", "hardship", "payment"] as const;
export type MomentType = (typeof MOMENT_TYPES)[number];
export type Moment = { type: MomentType; start: number; label: string };

export type CallMetrics = {
  talkRatio: number; // agent share of speaking time, 0..1
  longestMonologueSec: number;
  silencePct: number;
  questionsAsked: number;
  languageMix: Partial<Record<Lang, number>>; // share of speaking time, 0..1
};

/* ---------- Authored call templates (content/call-templates/*.json) ---------- */

export const templateSchema = z.object({
  id: z.string(),
  categoryId: z.string(),
  language: z.enum(["ta-en", "kn-en", "hi-en"]),
  quality: z.enum(["good", "average", "poor"]),
  customerName: z.string(),
  lines: z
    .array(
      z.object({
        speaker: z.enum(["agent", "customer"]),
        lang: z.enum(LANGS),
        text: z.string().min(1),
        roman: z.string().optional(),
      }),
    )
    .min(8),
  analysis: z.object({
    outcomeId: z.string(),
    outcomeRationale: z.string(),
    summary: z.string(),
    observations: z.string(),
    improvements: z.string(),
    extractions: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
    criteria: z.record(
      z.string(),
      z.object({
        result: z.enum(["pass", "fail", "na"]),
        line: z.number().int().nullable(), // index into lines used as evidence
        rationale: z.string(),
        confidence: z.number().min(0).max(1),
      }),
    ),
    moments: z.array(z.object({ type: z.enum(MOMENT_TYPES), line: z.number().int(), label: z.string() })),
  }),
});

export type CallTemplate = z.infer<typeof templateSchema>;

/* ---------- Shared UI helpers ---------- */

export type Role = "admin" | "manager" | "agent";

export function scoreTone(score: number | null | undefined): "success" | "warning" | "danger" | "muted" {
  if (score == null) return "muted";
  if (score >= 80) return "success";
  if (score >= 60) return "warning";
  return "danger";
}

export const SCORE_BUCKETS = {
  excellent: { label: "Excellent (90+)", min: 90, max: 100 },
  good: { label: "Good (70–89)", min: 70, max: 89 },
  fair: { label: "Fair (50–69)", min: 50, max: 69 },
  poor: { label: "Poor (<50)", min: 0, max: 49 },
} as const;

export const DURATION_BUCKETS = {
  lt2: { label: "< 2 min", min: 0, max: 120 },
  "2to5": { label: "2–5 min", min: 120, max: 300 },
  "5to10": { label: "5–10 min", min: 300, max: 600 },
  gt10: { label: "10+ min", min: 600, max: 1e9 },
} as const;

export const LANG_LABEL: Record<Lang, string> = { en: "English", ta: "Tamil", kn: "Kannada", hi: "Hindi" };
