CREATE TABLE "call_tags" (
	"call_id" text NOT NULL,
	"tag_id" text NOT NULL,
	CONSTRAINT "call_tags_call_id_tag_id_pk" PRIMARY KEY("call_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"category_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"uploaded_by" text,
	"status" text NOT NULL,
	"ready_at" timestamp with time zone,
	"failure_reason" text,
	"audio_url" text,
	"file_name" text,
	"duration_sec" integer NOT NULL,
	"call_at" timestamp with time zone NOT NULL,
	"language" text NOT NULL,
	"template_id" text,
	"is_simulated" boolean DEFAULT false NOT NULL,
	"rubric_version" integer DEFAULT 1 NOT NULL,
	"udfs" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"transcript" jsonb,
	"score" integer,
	"ai_score" integer,
	"outcome_id" text,
	"is_success" boolean,
	"is_not_applicable" boolean,
	"compliance_flag" boolean,
	"summary" text,
	"outcome_rationale" text,
	"observations" text,
	"improvements" text,
	"extractions" jsonb,
	"metrics" jsonb,
	"moments" jsonb,
	"review_note" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"icon" text NOT NULL,
	"rubric" jsonb NOT NULL,
	"rubric_version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "criterion_results" (
	"call_id" text NOT NULL,
	"section_id" text NOT NULL,
	"criterion_id" text NOT NULL,
	"ai_result" text NOT NULL,
	"override_result" text,
	"final_result" text NOT NULL,
	"rationale" text NOT NULL,
	"evidence_quote" text,
	"evidence_start" real,
	"confidence" real NOT NULL,
	CONSTRAINT "criterion_results_call_id_criterion_id_pk" PRIMARY KEY("call_id","criterion_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"language" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"team_id" text,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "call_tags" ADD CONSTRAINT "call_tags_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_tags" ADD CONSTRAINT "call_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "criterion_results" ADD CONSTRAINT "criterion_results_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calls_org_cat_date" ON "calls" USING btree ("org_id","category_id","call_at");--> statement-breakpoint
CREATE INDEX "calls_org_agent_date" ON "calls" USING btree ("org_id","agent_id","call_at");--> statement-breakpoint
CREATE INDEX "calls_status_ready" ON "calls" USING btree ("status","ready_at");--> statement-breakpoint
CREATE INDEX "cr_criterion_result" ON "criterion_results" USING btree ("criterion_id","final_result");