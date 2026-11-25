-- Platform API + real pipeline (docs/05-pipeline-and-api-plan.md §6).
-- Renames the code/DB vocabulary (calls → conversations, teams → cohorts, agent → person) and adds
-- provenance, rubric versions, the event outbox and rate limits. Existing data is kept.

-- organizations: settings
ALTER TABLE "organizations" ADD COLUMN "min_duration_sec" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "keyterms" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "retention_days" integer;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "default_language" text;--> statement-breakpoint

-- teams → cohorts
ALTER TABLE "teams" RENAME TO "cohorts";--> statement-breakpoint
ALTER TABLE "cohorts" RENAME CONSTRAINT "teams_pkey" TO "cohorts_pkey";--> statement-breakpoint
ALTER TABLE "cohorts" RENAME CONSTRAINT "teams_org_id_organizations_id_fk" TO "cohorts_org_id_organizations_id_fk";--> statement-breakpoint
ALTER TABLE "cohorts" ALTER COLUMN "language" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cohorts" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint

-- users: cohort, external id, optional email
ALTER TABLE "users" RENAME COLUMN "team_id" TO "cohort_id";--> statement-breakpoint
ALTER TABLE "users" RENAME CONSTRAINT "users_team_id_teams_id_fk" TO "users_cohort_id_cohorts_id_fk";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_org_external" ON "users" USING btree ("org_id","external_id");--> statement-breakpoint

-- tags: one slug per org
CREATE UNIQUE INDEX "tags_org_slug" ON "tags" USING btree ("org_id","slug");--> statement-breakpoint

-- rubric versions (backfilled with each category's current rubric)
CREATE TABLE "rubric_versions" (
	"category_id" text NOT NULL,
	"version" integer NOT NULL,
	"rubric" jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rubric_versions_category_id_version_pk" PRIMARY KEY("category_id","version")
);--> statement-breakpoint
ALTER TABLE "rubric_versions" ADD CONSTRAINT "rubric_versions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_versions" ADD CONSTRAINT "rubric_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
INSERT INTO "rubric_versions" ("category_id", "version", "rubric", "created_at")
  SELECT "id", "rubric_version", "rubric", "updated_at" FROM "categories";--> statement-breakpoint

-- calls → conversations
ALTER TABLE "calls" RENAME TO "conversations";--> statement-breakpoint
ALTER TABLE "conversations" RENAME CONSTRAINT "calls_pkey" TO "conversations_pkey";--> statement-breakpoint
ALTER TABLE "conversations" RENAME CONSTRAINT "calls_org_id_organizations_id_fk" TO "conversations_org_id_organizations_id_fk";--> statement-breakpoint
ALTER TABLE "conversations" RENAME CONSTRAINT "calls_category_id_categories_id_fk" TO "conversations_category_id_categories_id_fk";--> statement-breakpoint
ALTER TABLE "conversations" RENAME CONSTRAINT "calls_agent_id_users_id_fk" TO "conversations_person_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "conversations" RENAME CONSTRAINT "calls_uploaded_by_users_id_fk" TO "conversations_uploaded_by_users_id_fk";--> statement-breakpoint
ALTER TABLE "conversations" RENAME CONSTRAINT "calls_reviewed_by_users_id_fk" TO "conversations_audited_by_users_id_fk";--> statement-breakpoint
ALTER TABLE "conversations" RENAME COLUMN "agent_id" TO "person_id";--> statement-breakpoint
ALTER TABLE "conversations" RENAME COLUMN "call_at" TO "occurred_at";--> statement-breakpoint
ALTER TABLE "conversations" RENAME COLUMN "udfs" TO "metadata";--> statement-breakpoint
ALTER TABLE "conversations" RENAME COLUMN "compliance_flag" TO "risk_flag";--> statement-breakpoint
ALTER TABLE "conversations" RENAME COLUMN "review_note" TO "audit_note";--> statement-breakpoint
ALTER TABLE "conversations" RENAME COLUMN "reviewed_by" TO "audited_by";--> statement-breakpoint
ALTER TABLE "conversations" RENAME COLUMN "reviewed_at" TO "audited_at";--> statement-breakpoint
ALTER TABLE "conversations" RENAME COLUMN "failure_reason" TO "failure_message";--> statement-breakpoint
ALTER TABLE "conversations" RENAME COLUMN "template_id" TO "sample_id";--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "language" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "duration_sec" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "stage" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "failure_code" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "failure_stage" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "failure_retryable" boolean;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "audio_key" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "playback_key" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "channels" integer;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "sample_rate" integer;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "channel_layout" text DEFAULT 'left' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "language_detected" jsonb;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "current_analysis_id" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
-- statuses: done → completed; remote URLs move to source_url; the demo clips are bundled samples
UPDATE "conversations" SET "status" = 'completed' WHERE "status" = 'done';--> statement-breakpoint
UPDATE "conversations" SET "source_url" = "audio_url" WHERE "audio_url" ~* '^https?://';--> statement-breakpoint
UPDATE "conversations" SET "audio_key" = substr("audio_url", 2) WHERE "audio_url" LIKE '/uploads/%';--> statement-breakpoint
UPDATE "conversations" SET "sample_id" = NULL WHERE "is_simulated" = true;--> statement-breakpoint
UPDATE "conversations" SET "failure_code" = CASE WHEN "failure_message" ILIKE 'Unable to ingest%' OR "failure_message" ILIKE 'Recording is empty%' THEN 'audio_invalid' ELSE 'analysis_failed' END,
  "failure_stage" = CASE WHEN "failure_message" ILIKE 'Unable to ingest%' OR "failure_message" ILIKE 'Recording is empty%' THEN 'ingesting' ELSE 'analyzing' END,
  "failure_retryable" = false
  WHERE "status" = 'failed';--> statement-breakpoint
UPDATE "conversations" SET "updated_at" = COALESCE("completed_at", "created_at");--> statement-breakpoint
DROP INDEX "calls_status_ready";--> statement-breakpoint
ALTER TABLE "conversations" DROP COLUMN "audio_url";--> statement-breakpoint
ALTER TABLE "conversations" DROP COLUMN "is_simulated";--> statement-breakpoint
ALTER TABLE "conversations" DROP COLUMN "ready_at";--> statement-breakpoint
ALTER TABLE "conversations" DROP COLUMN "ingest_pending";--> statement-breakpoint
ALTER INDEX "calls_org_cat_date" RENAME TO "conv_org_cat_date";--> statement-breakpoint
ALTER INDEX "calls_org_agent_date" RENAME TO "conv_org_person_date";--> statement-breakpoint
CREATE INDEX "conv_org_updated" ON "conversations" USING btree ("org_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conv_org_external" ON "conversations" USING btree ("org_id","external_id");--> statement-breakpoint

-- criterion_results
ALTER TABLE "criterion_results" RENAME COLUMN "call_id" TO "conversation_id";--> statement-breakpoint
ALTER TABLE "criterion_results" RENAME CONSTRAINT "criterion_results_call_id_calls_id_fk" TO "criterion_results_conversation_id_conversations_id_fk";--> statement-breakpoint
ALTER TABLE "criterion_results" RENAME CONSTRAINT "criterion_results_call_id_criterion_id_pk" TO "criterion_results_conversation_id_criterion_id_pk";--> statement-breakpoint
ALTER TABLE "criterion_results" ADD COLUMN "source" text DEFAULT 'ai' NOT NULL;--> statement-breakpoint
ALTER TABLE "criterion_results" ADD COLUMN "evidence_end" real;--> statement-breakpoint
ALTER TABLE "criterion_results" ADD COLUMN "evidence_verified" boolean;--> statement-breakpoint
UPDATE "criterion_results" SET "source" = 'rule' WHERE "ai_result" = 'na' AND "na_reason" IS NOT NULL AND "na_reason" <> 'Not enough information in the call';--> statement-breakpoint
UPDATE "criterion_results" SET "evidence_verified" = true WHERE "evidence_quote" IS NOT NULL;--> statement-breakpoint

-- call_tags → conversation_tags
ALTER TABLE "call_tags" RENAME TO "conversation_tags";--> statement-breakpoint
ALTER TABLE "conversation_tags" RENAME COLUMN "call_id" TO "conversation_id";--> statement-breakpoint
ALTER TABLE "conversation_tags" RENAME CONSTRAINT "call_tags_call_id_tag_id_pk" TO "conversation_tags_conversation_id_tag_id_pk";--> statement-breakpoint
ALTER TABLE "conversation_tags" RENAME CONSTRAINT "call_tags_call_id_calls_id_fk" TO "conversation_tags_conversation_id_conversations_id_fk";--> statement-breakpoint
ALTER TABLE "conversation_tags" DROP CONSTRAINT "call_tags_tag_id_tags_id_fk";--> statement-breakpoint
ALTER TABLE "conversation_tags" ADD CONSTRAINT "conversation_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- analyses
CREATE TABLE "analyses" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"rubric_version" integer NOT NULL,
	"prompt_version" text,
	"asr_model" text,
	"llm_model" text,
	"used_fallback" boolean DEFAULT false NOT NULL,
	"audio_seconds" real,
	"input_tokens" integer,
	"cached_tokens" integer,
	"output_tokens" integer,
	"cost_micros_usd" integer,
	"repaired" boolean DEFAULT false NOT NULL,
	"raw_output" jsonb,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analyses_conv" ON "analyses" USING btree ("conversation_id","started_at");--> statement-breakpoint

-- api keys: scopes
ALTER TABLE "api_keys" ADD COLUMN "scope" text DEFAULT 'write' NOT NULL;--> statement-breakpoint

-- webhooks: failure tracking
ALTER TABLE "webhooks" ADD COLUMN "failing_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "event_id" text;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint

-- event outbox
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"type" text NOT NULL,
	"conversation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_undispatched" ON "events" USING btree ("dispatched_at","created_at");--> statement-breakpoint

-- rate limits
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
