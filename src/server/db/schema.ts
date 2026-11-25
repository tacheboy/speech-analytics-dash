import { boolean, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp } from "drizzle-orm/pg-core";
import type { CallMetrics, CriterionResultValue, Moment, Rubric, TranscriptSegment } from "@/lib/domain";

export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

export const teams = pgTable("teams", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  language: text("language").notNull(),
});

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  teamId: text("team_id").references(() => teams.id),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: text("role").$type<"admin" | "manager" | "agent">().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deactivatedAt: timestamp("deactivated_at", { withTimezone: true }), // "deleted" agents keep their call history
});

export const categories = pgTable("categories", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  description: text("description").notNull(),
  icon: text("icon").notNull(),
  rubric: jsonb("rubric").$type<Rubric>().notNull(),
  rubricVersion: integer("rubric_version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Hierarchical tags: the slug path encodes the tree ("objection/financial/job-loss"). */
export const tags = pgTable("tags", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  slug: text("slug").notNull(),
  displayName: text("display_name").notNull(),
  description: text("description"),
  assignable: boolean("assignable").notNull().default(false), // managers can apply it by hand
});

export const calls = pgTable(
  "calls",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    categoryId: text("category_id").notNull().references(() => categories.id),
    agentId: text("agent_id").notNull().references(() => users.id),
    uploadedBy: text("uploaded_by").references(() => users.id),
    status: text("status").$type<"processing" | "done" | "failed">().notNull(),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    ingestPending: boolean("ingest_pending").notNull().default(false), // remote recording still downloading
    completedAt: timestamp("completed_at", { withTimezone: true }), // reached done / failed
    failureReason: text("failure_reason"),
    audioUrl: text("audio_url"),
    fileName: text("file_name"),
    durationSec: integer("duration_sec").notNull(),
    callAt: timestamp("call_at", { withTimezone: true }).notNull(),
    language: text("language").notNull(),
    templateId: text("template_id"),
    isSimulated: boolean("is_simulated").notNull().default(false),
    rubricVersion: integer("rubric_version").notNull().default(1),
    udfs: jsonb("udfs").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // analysis (null until status = done)
    transcript: jsonb("transcript").$type<TranscriptSegment[]>(),
    score: integer("score"),
    aiScore: integer("ai_score"),
    outcomeId: text("outcome_id"),
    isSuccess: boolean("is_success"),
    isNotApplicable: boolean("is_not_applicable"),
    complianceFlag: boolean("compliance_flag"),
    summary: text("summary"),
    outcomeRationale: text("outcome_rationale"),
    observations: text("observations"),
    improvements: text("improvements"),
    extractions: jsonb("extractions").$type<Record<string, string | number | boolean | null>>(),
    metrics: jsonb("metrics").$type<CallMetrics>(),
    moments: jsonb("moments").$type<Moment[]>(),
    reviewNote: text("review_note"),
    reviewedBy: text("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (t) => [
    index("calls_org_cat_date").on(t.orgId, t.categoryId, t.callAt),
    index("calls_org_agent_date").on(t.orgId, t.agentId, t.callAt),
    index("calls_status_ready").on(t.status, t.readyAt),
  ],
);

export const criterionResults = pgTable(
  "criterion_results",
  {
    callId: text("call_id").notNull().references(() => calls.id, { onDelete: "cascade" }),
    sectionId: text("section_id").notNull(),
    criterionId: text("criterion_id").notNull(),
    aiResult: text("ai_result").$type<CriterionResultValue>().notNull(),
    overrideResult: text("override_result").$type<CriterionResultValue>(),
    finalResult: text("final_result").$type<CriterionResultValue>().notNull(),
    rationale: text("rationale").notNull(),
    evidenceQuote: text("evidence_quote"),
    evidenceStart: real("evidence_start"),
    confidence: real("confidence").notNull(),
    naReason: text("na_reason"), // why the criterion is NA (rule description, or missing information)
  },
  (t) => [primaryKey({ columns: [t.callId, t.criterionId] }), index("cr_criterion_result").on(t.criterionId, t.finalResult)],
);

export const callTags = pgTable(
  "call_tags",
  {
    callId: text("call_id").notNull().references(() => calls.id, { onDelete: "cascade" }),
    tagId: text("tag_id").notNull().references(() => tags.id),
    source: text("source").$type<"rule" | "manual">().notNull().default("rule"),
  },
  (t) => [primaryKey({ columns: [t.callId, t.tagId] })],
);

/* ---------- external API ---------- */

export const apiKeys = pgTable("api_keys", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(), // first characters, shown in the UI
  hash: text("hash").notNull().unique(), // sha256 of the full key; the key itself is shown once
  createdBy: text("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const webhooks = pgTable("webhooks", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  url: text("url").notNull(),
  events: jsonb("events").$type<string[]>().notNull(),
  secret: text("secret").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: text("id").primaryKey(),
    webhookId: text("webhook_id").notNull().references(() => webhooks.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    statusCode: integer("status_code"),
    responseBody: text("response_body"),
    error: text("error"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("deliveries_webhook_date").on(t.webhookId, t.createdAt)],
);
