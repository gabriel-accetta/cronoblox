CREATE TYPE "public"."evidence_kind" AS ENUM('fact', 'inference', 'recommendation');--> statement-breakpoint
CREATE TYPE "public"."evidence_relationship" AS ENUM('supports', 'contradicts', 'contextualizes', 'unresolved');--> statement-breakpoint
CREATE TYPE "public"."module_status" AS ENUM('completed', 'degraded', 'skipped', 'failed');--> statement-breakpoint
CREATE TYPE "public"."run_state" AS ENUM('QUEUED', 'COLLECT_CORE', 'PLAN', 'EXECUTE', 'RECORD', 'SYNTHESIZE', 'CRITIQUE', 'ROUTE', 'FINALIZE', 'COMPLETED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "analysis_profiles" (
	"id" text NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluation_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"reviewer" text,
	"rubric" jsonb NOT NULL,
	"total" numeric,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"module_id" text NOT NULL,
	"kind" "evidence_kind" NOT NULL,
	"relationship" "evidence_relationship" NOT NULL,
	"claim" text NOT NULL,
	"support_strength" text NOT NULL,
	"source_type" text NOT NULL,
	"source_url" text,
	"observed_at" timestamp with time zone NOT NULL,
	"record" jsonb NOT NULL,
	"supersedes_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"cache_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status_code" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"artifact_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"report" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_run_id_unique" UNIQUE("run_id")
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"state" "run_state" NOT NULL,
	"level" text NOT NULL,
	"event_type" text NOT NULL,
	"message" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_modules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"module_id" text NOT NULL,
	"module_version" text NOT NULL,
	"status" "module_status" NOT NULL,
	"output" jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metrics" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"state" "run_state" NOT NULL,
	"idempotency_key" text NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"input" jsonb NOT NULL,
	"state" "run_state" DEFAULT 'QUEUED' NOT NULL,
	"profile_snapshot" jsonb NOT NULL,
	"place_id" text,
	"universe_id" text,
	"game_name" text,
	"error" text,
	"cancelled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evaluation_scores" ADD CONSTRAINT "evaluation_scores_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_artifacts" ADD CONSTRAINT "raw_artifacts_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_modules" ADD CONSTRAINT "run_modules_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_profiles_id_version_uq" ON "analysis_profiles" USING btree ("id","version");--> statement-breakpoint
CREATE INDEX "evidence_run_module_idx" ON "evidence" USING btree ("run_id","module_id");--> statement-breakpoint
CREATE INDEX "evidence_kind_relationship_idx" ON "evidence" USING btree ("run_id","kind","relationship");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_cache_key_uq" ON "provider_cache" USING btree ("provider","cache_key");--> statement-breakpoint
CREATE INDEX "provider_cache_lookup_idx" ON "provider_cache" USING btree ("provider","cache_key","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_artifacts_key_uq" ON "raw_artifacts" USING btree ("run_id","provider","artifact_key");--> statement-breakpoint
CREATE UNIQUE INDEX "run_events_sequence_uq" ON "run_events" USING btree ("run_id","sequence");--> statement-breakpoint
CREATE INDEX "run_events_run_idx" ON "run_events" USING btree ("run_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "run_modules_run_module_uq" ON "run_modules" USING btree ("run_id","module_id");--> statement-breakpoint
CREATE UNIQUE INDEX "run_steps_idempotency_uq" ON "run_steps" USING btree ("run_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "run_steps_sequence_idx" ON "run_steps" USING btree ("run_id","sequence");--> statement-breakpoint
CREATE INDEX "runs_universe_created_idx" ON "runs" USING btree ("universe_id","created_at");