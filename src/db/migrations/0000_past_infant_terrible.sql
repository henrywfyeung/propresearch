CREATE TYPE "public"."email_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."llm_provider" AS ENUM('openai', 'anthropic');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'superseded');--> statement-breakpoint
CREATE TABLE "allowed_emails" (
	"email" text PRIMARY KEY NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"added_by" text,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"actor_user_id" uuid,
	"report_id" uuid,
	"details" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_calls" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"report_id" uuid,
	"node" text NOT NULL,
	"provider" "llm_provider" NOT NULL,
	"model" text NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 6) NOT NULL,
	"latency_ms" integer,
	"succeeded" text DEFAULT 'true' NOT NULL,
	"langfuse_trace_id" text,
	"prompt_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nsw_vg_sales" (
	"prop_id" text NOT NULL,
	"contract_date" timestamp NOT NULL,
	"purchase_price" numeric(14, 2) NOT NULL,
	"address" text NOT NULL,
	"suburb" varchar(80),
	"postcode" varchar(4),
	"district" text,
	"zone_code" varchar(8),
	"property_type" text,
	"land_area_sqm" numeric(12, 2),
	"nature_of_property" varchar(8),
	"settlement_date" timestamp,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nsw_vg_sales_prop_id_contract_date_pk" PRIMARY KEY("prop_id","contract_date")
);
--> statement-breakpoint
CREATE TABLE "pending_stats_callbacks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"listing_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_counters" (
	"user_id" uuid NOT NULL,
	"day" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_limit_counters_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "report_node_artifacts" (
	"report_id" uuid NOT NULL,
	"node" text NOT NULL,
	"item_key" text NOT NULL,
	"revision_round" integer DEFAULT 0 NOT NULL,
	"payload" jsonb NOT NULL,
	"cost_usd" numeric(10, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_node_artifacts_report_id_node_item_key_pk" PRIMARY KEY("report_id","node","item_key")
);
--> statement-breakpoint
CREATE TABLE "report_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"pdf_url" text NOT NULL,
	"state_snapshot_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "report_status" DEFAULT 'queued' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"supersedes_id" uuid,
	"state" jsonb,
	"subject_address" text,
	"domain_property_id" text,
	"pdf_url" text,
	"total_cost_usd" numeric(10, 4),
	"total_tokens" integer,
	"current_node" text,
	"error_message" text,
	"email_error_message" text,
	"email_status" "email_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_limit_counters" ADD CONSTRAINT "rate_limit_counters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_node_artifacts" ADD CONSTRAINT "report_node_artifacts_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_versions" ADD CONSTRAINT "report_versions_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_supersedes_id_reports_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_actor_created_idx" ON "audit_log" USING btree ("actor_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_action_created_idx" ON "audit_log" USING btree ("action","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "llm_calls_report_idx" ON "llm_calls" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "llm_calls_provider_created_idx" ON "llm_calls" USING btree ("provider","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "nsw_vg_suburb_postcode_idx" ON "nsw_vg_sales" USING btree ("suburb","postcode");--> statement-breakpoint
CREATE INDEX "nsw_vg_contract_date_idx" ON "nsw_vg_sales" USING btree ("contract_date");--> statement-breakpoint
CREATE INDEX "pending_stats_next_attempt_idx" ON "pending_stats_callbacks" USING btree ("next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "report_versions_report_version_idx" ON "report_versions" USING btree ("report_id","version");--> statement-breakpoint
CREATE INDEX "reports_user_created_idx" ON "reports" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reports_dedupe_idx" ON "reports" USING btree ("domain_property_id","created_at" DESC NULLS LAST) WHERE status IN ('succeeded', 'running');--> statement-breakpoint
CREATE INDEX "reports_running_idx" ON "reports" USING btree ("updated_at") WHERE status = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");