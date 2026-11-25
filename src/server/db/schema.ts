import { boolean, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { CallMetrics, CriterionResultValue, Moment, Rubric, TranscriptSegment } from "@/lib/domain";

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  // org settings
  minDurationSec: integer("min_duration_sec").notNull().default(15), // shorter recordings are skipped (not billed)
  keyterms: jsonb("keyterms").$type<string[]>().notNull().default([]), // vocabulary passed to ASR
  retentionDays: integer("retention_days"), // null = keep forever
  defaultLanguage: text("default_language"),
});

export const cohorts = pgTable("cohorts", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  language: text("language"), // default ASR language hint for its people, e.g. "ta-en"
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** Everyone in the org. People (the API's "Person") are users with role `member`. */
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    cohortId: text("cohort_id").references(() => cohorts.id),
    externalId: text("external_id"), // the dialer's agent id
    name: text("name").notNull(),
    email: text("email").unique(),
    role: text("role").$type<"admin" | "manager" | "member">().notNull(),
    passwordHash: text("password_hash"), // scrypt; null = can't sign in with a password (people, demo users)
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    deactivatedAt: ts("deactivated_at"), // deactivated people keep their conversation history
  },
  (t) => [uniqueIndex("users_org_external").on(t.orgId, t.externalId)],
);

export const categories = pgTable("categories", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  description: text("description").notNull(),
  icon: text("icon").notNull(),
  rubric: jsonb("rubric").$type<Rubric>().notNull(), // the published (current) version
  rubricVersion: integer("rubric_version").notNull().default(1),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Immutable history of published rubrics. Every analysis points at one. */
export const rubricVersions = pgTable(
  "rubric_versions",
  {
    categoryId: text("category_id").notNull().references(() => categories.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    rubric: jsonb("rubric").$type<Rubric>().notNull(),
    createdBy: text("created_by").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.categoryId, t.version] })],
);

/** Hierarchical tags: the slug path encodes the tree ("objection/financial/job-loss"). */
export const tags = pgTable(
  "tags",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    slug: text("slug").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description"),
    assignable: boolean("assignable").notNull().default(false), // managers can apply it by hand
  },
  (t) => [uniqueIndex("tags_org_slug").on(t.orgId, t.slug)],
);

export type ConversationStatus = "queued" | "processing" | "completed" | "failed" | "skipped";
export type ConversationStage = "ingesting" | "transcribing" | "analyzing";

export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    externalId: text("external_id"), // the dialer's call id: natural idempotency key
    categoryId: text("category_id").notNull().references(() => categories.id),
    personId: text("person_id").notNull().references(() => users.id),
    uploadedBy: text("uploaded_by").references(() => users.id),
    status: text("status").$type<ConversationStatus>().notNull(),
    stage: text("stage").$type<ConversationStage>(),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    failureStage: text("failure_stage"),
    failureRetryable: boolean("failure_retryable"),
    // audio
    sourceUrl: text("source_url"), // remote recording URL as submitted
    sampleId: text("sample_id"), // bundled demo recording (and the script the mock providers replay)
    audioKey: text("audio_key"), // storage key of the original
    playbackKey: text("playback_key"), // storage key of the browser playback file
    fileName: text("file_name"),
    durationSec: integer("duration_sec").notNull().default(0),
    channels: integer("channels"),
    sampleRate: integer("sample_rate"),
    channelLayout: text("channel_layout").$type<"left" | "right" | "mono">().notNull().default("left"), // which side is the person
    language: text("language"), // hint, e.g. "ta-en"
    languageDetected: jsonb("language_detected").$type<Record<string, number>>(),
    occurredAt: ts("occurred_at").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    rubricVersion: integer("rubric_version").notNull().default(1),
    currentAnalysisId: text("current_analysis_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    completedAt: ts("completed_at"),
    deletedAt: ts("deleted_at"), // erasure tombstone
    // analysis (null until completed)
    transcript: jsonb("transcript").$type<TranscriptSegment[]>(),
    score: integer("score"),
    aiScore: integer("ai_score"),
    outcomeId: text("outcome_id"),
    outcomeRationale: text("outcome_rationale"),
    isSuccess: boolean("is_success"),
    isNotApplicable: boolean("is_not_applicable"),
    riskFlag: boolean("risk_flag"),
    summary: text("summary"),
    observations: text("observations"),
    improvements: text("improvements"),
    extractions: jsonb("extractions").$type<Record<string, string | number | boolean | null>>(),
    metrics: jsonb("metrics").$type<CallMetrics>(),
    moments: jsonb("moments").$type<Moment[]>(),
    // human audit
    auditNote: text("audit_note"),
    auditedBy: text("audited_by").references(() => users.id),
    auditedAt: ts("audited_at"),
  },
  (t) => [
    index("conv_org_cat_date").on(t.orgId, t.categoryId, t.occurredAt),
    index("conv_org_person_date").on(t.orgId, t.personId, t.occurredAt),
    index("conv_org_updated").on(t.orgId, t.updatedAt),
    uniqueIndex("conv_org_external").on(t.orgId, t.externalId),
  ],
);

export const criterionResults = pgTable(
  "criterion_results",
  {
    conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    sectionId: text("section_id").notNull(),
    criterionId: text("criterion_id").notNull(),
    aiResult: text("ai_result").$type<CriterionResultValue>().notNull(),
    overrideResult: text("override_result").$type<CriterionResultValue>(),
    finalResult: text("final_result").$type<CriterionResultValue>().notNull(),
    source: text("source").$type<"ai" | "rule">().notNull().default("ai"), // who produced aiResult; an override makes it "audit"
    rationale: text("rationale").notNull(),
    evidenceQuote: text("evidence_quote"),
    evidenceStart: real("evidence_start"),
    evidenceEnd: real("evidence_end"),
    evidenceVerified: boolean("evidence_verified"),
    confidence: real("confidence").notNull(),
    naReason: text("na_reason"), // why the criterion is NA (rule description, or missing information)
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.criterionId] }), index("cr_criterion_result").on(t.criterionId, t.finalResult)],
);

export const conversationTags = pgTable(
  "conversation_tags",
  {
    conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    tagId: text("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
    source: text("source").$type<"rule" | "manual">().notNull().default("rule"),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.tagId] })],
);

/** One row per analysis run: provenance, usage and cost. */
export const analyses = pgTable(
  "analyses",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"initial" | "reanalysis">().notNull(),
    status: text("status").$type<"running" | "completed" | "failed">().notNull(),
    rubricVersion: integer("rubric_version").notNull(),
    promptVersion: text("prompt_version"),
    asrModel: text("asr_model"), // provider:model
    llmModel: text("llm_model"), // provider:model that produced the result
    usedFallback: boolean("used_fallback").notNull().default(false),
    audioSeconds: real("audio_seconds"),
    inputTokens: integer("input_tokens"),
    cachedTokens: integer("cached_tokens"),
    outputTokens: integer("output_tokens"),
    costMicrosUsd: integer("cost_micros_usd"), // null when a model has no price entry
    repaired: boolean("repaired").notNull().default(false),
    rawOutput: jsonb("raw_output"), // validated model output, kept for finalize, debugging and evals
    error: text("error"),
    startedAt: ts("started_at").notNull().defaultNow(),
    completedAt: ts("completed_at"),
  },
  (t) => [index("analyses_conv").on(t.conversationId, t.startedAt)],
);

/* ---------- API keys, webhooks, events ---------- */

export const apiKeys = pgTable("api_keys", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  scope: text("scope").$type<"read" | "write">().notNull().default("write"),
  prefix: text("prefix").notNull(), // first characters, shown in the UI
  hash: text("hash").notNull().unique(), // sha256 of the full key; the key itself is shown once
  createdBy: text("created_by").references(() => users.id),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastUsedAt: ts("last_used_at"),
  revokedAt: ts("revoked_at"),
});

export const webhooks = pgTable("webhooks", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  url: text("url").notNull(),
  events: jsonb("events").$type<string[]>().notNull(),
  secret: text("secret").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
  failingSince: ts("failing_since"), // first failed delivery (after retries) since the last success
  disabledAt: ts("disabled_at"), // auto-disabled after failing for 3 days
});

/** Transactional outbox: written in the same transaction as the state change it describes. */
export const events = pgTable(
  "events",
  {
    id: text("id").primaryKey(), // evt_…
    orgId: text("org_id").notNull().references(() => organizations.id),
    type: text("type").notNull(),
    conversationId: text("conversation_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
    dispatchedAt: ts("dispatched_at"),
  },
  (t) => [index("events_undispatched").on(t.dispatchedAt, t.createdAt)],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: text("id").primaryKey(),
    webhookId: text("webhook_id").notNull().references(() => webhooks.id, { onDelete: "cascade" }),
    eventId: text("event_id"),
    attempt: integer("attempt").notNull().default(1),
    event: text("event").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    statusCode: integer("status_code"),
    responseBody: text("response_body"),
    error: text("error"),
    durationMs: integer("duration_ms"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("deliveries_webhook_date").on(t.webhookId, t.createdAt)],
);

/** Fixed-window request counter per API key. */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: ts("window_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);
