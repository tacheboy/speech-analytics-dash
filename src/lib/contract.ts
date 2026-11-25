/**
 * The public API contract (/api/v1). These zod schemas are the single source of truth for request
 * validation, TypeScript types and the OpenAPI document (src/server/openapi.ts).
 * Rule: within v1 we only add fields; clients must ignore fields they don't know.
 */
import { z } from "zod";
import { MOMENT_TYPES, rubricSchema } from "./domain";

const list = z
  .union([z.string(), z.array(z.string())])
  .transform((v) => (Array.isArray(v) ? v : v.split(",")).map((s) => s.trim()).filter(Boolean));
const bool = z.enum(["true", "false"]).transform((v) => v === "true");
const isoDateTime = z.iso.datetime({ offset: true });
const dateOrDateTime = z.union([z.iso.date(), isoDateTime]);
const cursorPage = { limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.string().optional() };

/* ================= enums ================= */

export const CONVERSATION_STATUSES = ["queued", "processing", "completed", "failed", "skipped"] as const;
export const STAGES = ["ingesting", "transcribing", "analyzing"] as const;
export const RESULTS = ["yes", "no", "na"] as const;
export const OUTCOME_TYPES = ["success", "standard", "na"] as const;
export const EVENT_TYPES = ["conversation.completed", "conversation.failed", "conversation.updated"] as const;
export const FAILURE_CODES = ["audio_unreachable", "audio_forbidden", "audio_invalid", "too_short", "no_speech", "transcription_failed", "analysis_failed"] as const;
export type Result = (typeof RESULTS)[number];
export type EventType = (typeof EVENT_TYPES)[number];
export type FailureCode = (typeof FAILURE_CODES)[number];

/* ================= requests ================= */

export const createUploadBody = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentType: z.string().trim().min(1),
  sizeBytes: z.number().int().min(1).max(500 * 1024 * 1024).optional(),
});

const personRef = z
  .object({
    externalId: z.string().trim().min(1).max(200).optional(),
    email: z.email().optional(),
    name: z.string().trim().min(1).max(200).optional(),
  })
  .refine((p) => p.externalId || p.email, "person needs an externalId or an email");

export const createConversationBody = z
  .object({
    externalId: z.string().trim().min(1).max(200).optional().describe("Your id for this call (e.g. the dialer's call id). Unique per org: re-posting it returns the existing conversation."),
    audioUrl: z.url({ protocol: /^https?$/ }).optional().describe("A URL we can GET the recording from: a public or presigned URL, or the audioUrl from POST /uploads."),
    sampleId: z.string().optional().describe("Demo only: analyse one of the bundled sample recordings instead of audioUrl."),
    categoryId: z.string().min(1),
    personId: z.string().optional().describe("An existing person id (or ext:<externalId>). Use `person` to create or match one inline instead."),
    person: personRef.optional().describe("Matched by externalId, then email; created if missing (name required then)."),
    occurredAt: isoDateTime.optional().describe("When the call happened. Defaults to now."),
    language: z.string().regex(/^[a-z]{2}(-[a-z]{2})?$/).optional().describe("Language hint such as `ta-en` (code-mixed) or `hi`. Defaults to the person's cohort language."),
    channels: z.object({ person: z.enum(["left", "right", "mono"]) }).optional().describe("Stereo layout. Default: the person is on the left channel. `mono` forces diarization."),
    metadata: z.record(z.string(), z.unknown()).optional().refine((m) => !m || JSON.stringify(m).length <= 4096, "metadata must be at most 4 KB of JSON").describe("Free-form, returned as is, usable in targeting rules."),
  })
  .refine((b) => b.audioUrl || b.sampleId, { message: "Provide audioUrl (or sampleId for a demo recording)", path: ["audioUrl"] })
  .refine((b) => b.personId || b.person, { message: "Provide personId or person", path: ["person"] });
export type CreateConversationBody = z.infer<typeof createConversationBody>;

export const CONVERSATION_SORTS = ["occurredAt", "-occurredAt", "score", "-score", "durationSec", "-durationSec", "updatedAt"] as const;

export const listConversationsQuery = z.object({
  status: z.enum(CONVERSATION_STATUSES).optional(),
  categoryId: z.string().optional(),
  personId: list.optional(),
  cohortId: list.optional(),
  outcome: list.optional().describe("Outcome ids or labels"),
  outcomeType: z.enum(OUTCOME_TYPES).optional(),
  tag: list.optional().describe("Tag slugs; a parent slug matches every tag under it"),
  ext: list.optional().describe("Extracted values as field:value"),
  riskFlag: bool.optional(),
  audited: bool.optional(),
  needsReview: bool.optional().describe("Completed, not audited, and at least one answer is low-confidence or lacks verified evidence"),
  scoreMin: z.coerce.number().int().min(0).max(100).optional(),
  scoreMax: z.coerce.number().int().min(0).max(100).optional(),
  durationMin: z.coerce.number().int().min(0).optional(),
  durationMax: z.coerce.number().int().min(0).optional(),
  from: dateOrDateTime.optional().describe("occurredAt ≥ from (a date means 00:00 IST)"),
  to: dateOrDateTime.optional().describe("occurredAt ≤ to (a date means end of that day, IST)"),
  updatedSince: isoDateTime.optional().describe("Sync: conversations changed after this instant, oldest change first (includes deletions)."),
  q: z.string().trim().max(200).optional().describe("Search person name, conversation id or externalId"),
  sort: z.enum(CONVERSATION_SORTS).default("-occurredAt"),
  includeTotal: bool.optional(),
  ...cursorPage,
});
export type ListConversationsQuery = z.input<typeof listConversationsQuery>;

export const scorecardPatchBody = z.object({
  overrides: z.array(z.object({ criterionId: z.string(), result: z.enum(RESULTS).nullable().describe("null removes the override") })).default([]),
  outcomeId: z.string().optional(),
  tagSlugs: z.array(z.string()).optional().describe("Replaces the manually applied tags (rule tags stay)"),
  note: z.string().max(4000).optional(),
});
export type ScorecardPatchBody = z.input<typeof scorecardPatchBody>;

export const analyzeBody = z.object({
  rubricVersion: z.number().int().min(1).optional().describe("Re-score against this published version (default: current)."),
  dryRun: z.boolean().default(false).describe("Score and return the result without saving it."),
  rubric: rubricSchema.omit({ id: true }).optional().describe("Dry run only: a draft rubric to test before publishing it."),
});

export const personBody = z.object({
  externalId: z.string().trim().min(1).max(200).nullable().optional(),
  email: z.email().nullable().optional(),
  name: z.string().trim().min(1).max(200),
  cohortId: z.string().nullable().optional(),
});
export const personPatchBody = personBody.partial().extend({ active: z.boolean().optional() });
export const listPeopleQuery = z.object({ cohortId: z.string().optional(), active: bool.optional(), q: z.string().trim().optional(), ...cursorPage });

export const cohortBody = z.object({ name: z.string().trim().min(1).max(120), language: z.string().regex(/^[a-z]{2}(-[a-z]{2})?$/).nullable().optional() });

export const categoryBody = rubricSchema.omit({ id: true });
export type CategoryBody = z.infer<typeof categoryBody>;

export const tagBody = z.object({ displayName: z.string().trim().min(1).max(120), description: z.string().max(500).nullable().optional(), assignable: z.boolean().optional() });

export const webhookBody = z.object({
  url: z.url({ protocol: /^https?$/ }),
  events: z.array(z.enum(EVENT_TYPES)).min(1),
});

export const ANALYTICS_METRICS = ["volume", "qualityScore", "successRate", "riskRate", "minutes", "agreement", "costUsd", "passRate"] as const;
export const ANALYTICS_GROUPS = ["day", "week", "person", "cohort", "category", "outcome", "tag", "criterion"] as const;
export const analyticsQuery = z.object({
  metrics: list.pipe(z.array(z.enum(ANALYTICS_METRICS)).min(1)).default(["volume", "qualityScore", "successRate"]),
  groupBy: z.enum(ANALYTICS_GROUPS).optional(),
  categoryId: z.string().optional(),
  personId: list.optional(),
  cohortId: list.optional(),
  tag: list.optional(),
  from: dateOrDateTime.optional(),
  to: dateOrDateTime.optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});
export type AnalyticsQueryInput = z.input<typeof analyticsQuery>;

/* ================= response objects ================= */

export const failureObject = z.object({
  code: z.enum(FAILURE_CODES),
  message: z.string(),
  stage: z.enum(STAGES).nullable(),
  retryable: z.boolean(),
});

export const criterionObject = z.object({
  criterionId: z.string(),
  question: z.string(),
  result: z.enum(RESULTS),
  aiResult: z.enum(RESULTS).describe("The model's (or rule's) answer, kept when an auditor overrides it"),
  source: z.enum(["ai", "rule", "audit"]),
  naReason: z.string().nullable(),
  rationale: z.string(),
  confidence: z.number(),
  evidence: z.object({ quote: z.string(), start: z.number().nullable(), end: z.number().nullable(), verified: z.boolean() }).nullable(),
});

export const sectionObject = z.object({
  sectionId: z.string(),
  name: z.string(),
  passed: z.number().int(),
  applicable: z.number().int(),
  criteria: z.array(criterionObject),
});

export const segmentObject = z.object({
  start: z.number(),
  end: z.number(),
  speaker: z.enum(["person", "customer"]),
  lang: z.string(),
  text: z.string(),
  roman: z.string().optional(),
});

export const personSummary = z.object({ id: z.string(), externalId: z.string().nullable(), name: z.string(), email: z.string().nullable(), cohortId: z.string().nullable() });

export const conversationObject = z.object({
  object: z.literal("conversation"),
  id: z.string(),
  externalId: z.string().nullable(),
  status: z.enum(CONVERSATION_STATUSES),
  stage: z.enum(STAGES).nullable(),
  failure: failureObject.nullable(),
  deleted: z.boolean().optional().describe("Only on deletion tombstones (sync)"),
  categoryId: z.string(),
  rubricVersion: z.number().int(),
  person: personSummary,
  occurredAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
  audio: z.object({ durationSec: z.number(), channels: z.number().nullable(), fileName: z.string().nullable(), playbackUrl: z.string().nullable() }),
  language: z.object({ hint: z.string().nullable(), detected: z.record(z.string(), z.number()).nullable() }),
  score: z.number().nullable(),
  aiScore: z.number().nullable(),
  outcome: z.object({ id: z.string(), label: z.string(), type: z.enum(OUTCOME_TYPES), rationale: z.string().nullable() }).nullable(),
  riskFlag: z.boolean().nullable(),
  summary: z.string().nullable(),
  observations: z.string().nullable(),
  improvements: z.string().nullable(),
  scorecard: z.array(sectionObject).nullable(),
  extractions: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).nullable(),
  tags: z.array(z.object({ slug: z.string(), displayName: z.string(), source: z.enum(["rule", "manual"]) })),
  moments: z.array(z.object({ type: z.enum(MOMENT_TYPES), start: z.number(), label: z.string() })).nullable(),
  metrics: z
    .object({ talkRatio: z.number(), longestMonologueSec: z.number(), silencePct: z.number(), questionsAsked: z.number(), interruptions: z.number().optional(), languageMix: z.record(z.string(), z.number()) })
    .nullable(),
  transcript: z.array(segmentObject).nullable().optional().describe("Omitted in lists"),
  metadata: z.record(z.string(), z.unknown()),
  audit: z.object({ auditedBy: z.string().nullable(), auditedByName: z.string().nullable(), auditedAt: z.string(), note: z.string().nullable() }).nullable(),
  analysis: z
    .object({ id: z.string(), models: z.object({ asr: z.string().nullable(), llm: z.string().nullable() }), promptVersion: z.string().nullable(), simulated: z.boolean().describe("Mock providers produced this analysis") })
    .nullable(),
});
export type Conversation = z.infer<typeof conversationObject>;
export type ConversationSection = z.infer<typeof sectionObject>;
export type ConversationCriterion = z.infer<typeof criterionObject>;

export const personObject = personSummary.extend({ object: z.literal("person"), active: z.boolean(), createdAt: z.string(), updatedAt: z.string() });
export type Person = z.infer<typeof personObject>;
export const cohortObject = z.object({ object: z.literal("cohort"), id: z.string(), name: z.string(), language: z.string().nullable(), people: z.number().int(), createdAt: z.string() });
export type Cohort = z.infer<typeof cohortObject>;
export const tagObject = z.object({ object: z.literal("tag"), slug: z.string(), displayName: z.string(), description: z.string().nullable(), assignable: z.boolean(), parent: z.string().nullable() });
export type Tag = z.infer<typeof tagObject>;
export const categoryObject = categoryBody.extend({ object: z.literal("category"), id: z.string(), version: z.number().int(), versions: z.array(z.number().int()), createdAt: z.string(), updatedAt: z.string() });
export type Category = z.infer<typeof categoryObject>;
export const webhookObject = z.object({ object: z.literal("webhook"), id: z.string(), url: z.string(), events: z.array(z.string()), active: z.boolean(), secret: z.string().optional().describe("Only in the create response"), createdAt: z.string() });
export const uploadObject = z.object({ object: z.literal("upload"), uploadUrl: z.string(), audioUrl: z.string(), method: z.literal("PUT"), headers: z.record(z.string(), z.string()), expiresAt: z.string() });
export const analyticsObject = z.object({
  object: z.literal("analytics"),
  from: z.string(),
  to: z.string(),
  groupBy: z.enum(ANALYTICS_GROUPS).nullable(),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))).describe("One row per group: `key`, `label` and one column per requested metric"),
});
export type AnalyticsResult = z.infer<typeof analyticsObject>;

export const listOf = <T extends z.ZodType>(item: T) => z.object({ object: z.literal("list"), data: z.array(item), nextCursor: z.string().nullable(), total: z.number().int().optional() });
export type List<T> = { object: "list"; data: T[]; nextCursor: string | null; total?: number };

export const errorObject = z.object({
  error: z.object({
    type: z.enum(["invalid_request", "authentication", "permission", "not_found", "conflict", "rate_limited", "api_error"]),
    code: z.string(),
    message: z.string(),
    param: z.string().optional(),
    requestId: z.string(),
  }),
});

export const eventObject = z.object({ id: z.string(), type: z.enum(EVENT_TYPES), createdAt: z.string(), data: z.object({ conversation: conversationObject }) });
