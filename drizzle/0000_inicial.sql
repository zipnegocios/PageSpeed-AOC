CREATE TYPE "public"."alert_kind" AS ENUM('threshold', 'audit_failure');--> statement-breakpoint
CREATE TYPE "public"."alert_metric" AS ENUM('performance', 'seo', 'accessibility', 'best_practices');--> statement-breakpoint
CREATE TYPE "public"."alert_state_status" AS ENUM('open', 'resolved', 'suppressed');--> statement-breakpoint
CREATE TYPE "public"."audit_frequency" AS ENUM('weekly', 'daily');--> statement-breakpoint
CREATE TYPE "public"."audit_profile" AS ENUM('mobile', 'desktop');--> statement-breakpoint
CREATE TYPE "public"."audit_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."audit_trigger" AS ENUM('scheduled', 'manual', 'mcp');--> statement-breakpoint
CREATE TYPE "public"."auth_strategy" AS ENUM('none', 'cookie', 'script');--> statement-breakpoint
CREATE TYPE "public"."client_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('initial', 'reminder', 'failure', 'report');--> statement-breakpoint
CREATE TYPE "public"."project_phase" AS ENUM('development', 'production');--> statement-breakpoint
CREATE TYPE "public"."route_source" AS ENUM('sitemap', 'manual', 'adhoc');--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "alert_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"route_id" uuid NOT NULL,
	"profile" "audit_profile" NOT NULL,
	"kind" "alert_kind" NOT NULL,
	"metric" "alert_metric",
	"status" "alert_state_status" DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_by_audit_id" uuid,
	"last_value" smallint,
	"threshold_at_open" smallint,
	"last_notified_at" timestamp with time zone,
	"reminder_count" smallint DEFAULT 0 NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_audit_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_states_metric_matches_kind" CHECK (("alert_states"."kind" = 'threshold' and "alert_states"."metric" is not null)
        or ("alert_states"."kind" = 'audit_failure' and "alert_states"."metric" is null))
);
--> statement-breakpoint
CREATE TABLE "alert_thresholds" (
	"project_id" uuid NOT NULL,
	"metric" "alert_metric" NOT NULL,
	"min_score" smallint NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"confirm_runs" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_thresholds_project_id_metric_pk" PRIMARY KEY("project_id","metric"),
	CONSTRAINT "alert_thresholds_min_score_range" CHECK ("alert_thresholds"."min_score" between 0 and 100),
	CONSTRAINT "alert_thresholds_confirm_runs_min" CHECK ("alert_thresholds"."confirm_runs" >= 1)
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"route_id" uuid NOT NULL,
	"profile" "audit_profile" NOT NULL,
	"trigger" "audit_trigger" NOT NULL,
	"requested_by" text,
	"phase_at_run" "project_phase" NOT NULL,
	"status" "audit_status" DEFAULT 'queued' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_message" text,
	"score_performance" smallint,
	"score_seo" smallint,
	"score_accessibility" smallint,
	"score_best_practices" smallint,
	"lcp_ms" integer,
	"cls" numeric(7, 4),
	"tbt_ms" integer,
	"fcp_ms" integer,
	"ttfb_ms" integer,
	"inp_ms" integer,
	"lighthouse_version" text,
	"final_url" text,
	"http_status" smallint,
	"r2_key" text,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	CONSTRAINT "audit_logs_scores_range" CHECK (("audit_logs"."score_performance" is null or "audit_logs"."score_performance" between 0 and 100)
        and ("audit_logs"."score_seo" is null or "audit_logs"."score_seo" between 0 and 100)
        and ("audit_logs"."score_accessibility" is null or "audit_logs"."score_accessibility" between 0 and 100)
        and ("audit_logs"."score_best_practices" is null or "audit_logs"."score_best_practices" between 0 and 100))
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"status" "client_status" DEFAULT 'active' NOT NULL,
	"magic_token" text NOT NULL,
	"magic_token_rotated_at" timestamp with time zone,
	"notes" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_slug_unique" UNIQUE("slug"),
	CONSTRAINT "clients_magic_token_unique" UNIQUE("magic_token")
);
--> statement-breakpoint
CREATE TABLE "mcp_api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"alert_state_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"status" "notification_status" NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"base_url" text NOT NULL,
	"allowed_hosts" text[] DEFAULT '{}'::text[] NOT NULL,
	"phase" "project_phase" DEFAULT 'development' NOT NULL,
	"phase_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"audit_frequency" "audit_frequency" DEFAULT 'weekly' NOT NULL,
	"sitemap_url" text,
	"last_sitemap_scan_at" timestamp with time zone,
	"auth_strategy" "auth_strategy" DEFAULT 'none' NOT NULL,
	"auth_config_enc" "bytea",
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_client_slug_unique" UNIQUE("client_id","slug")
);
--> statement-breakpoint
CREATE TABLE "routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"path" text NOT NULL,
	"url" text NOT NULL,
	"label" text,
	"source" "route_source" DEFAULT 'manual' NOT NULL,
	"monitored" boolean DEFAULT false NOT NULL,
	"requires_auth" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "routes_project_path_unique" UNIQUE("project_id","path")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_states" ADD CONSTRAINT "alert_states_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_states" ADD CONSTRAINT "alert_states_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_states" ADD CONSTRAINT "alert_states_opened_by_audit_id_audit_logs_id_fk" FOREIGN KEY ("opened_by_audit_id") REFERENCES "public"."audit_logs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_states" ADD CONSTRAINT "alert_states_resolved_by_audit_id_audit_logs_id_fk" FOREIGN KEY ("resolved_by_audit_id") REFERENCES "public"."audit_logs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_thresholds" ADD CONSTRAINT "alert_thresholds_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_states_open_threshold_unique" ON "alert_states" USING btree ("route_id","profile","metric") WHERE "alert_states"."status" = 'open' and "alert_states"."kind" = 'threshold';--> statement-breakpoint
CREATE UNIQUE INDEX "alert_states_open_failure_unique" ON "alert_states" USING btree ("route_id","profile") WHERE "alert_states"."status" = 'open' and "alert_states"."kind" = 'audit_failure';--> statement-breakpoint
CREATE INDEX "alert_states_status_notified_idx" ON "alert_states" USING btree ("status","last_notified_at");--> statement-breakpoint
CREATE INDEX "audit_logs_route_profile_finished_idx" ON "audit_logs" USING btree ("route_id","profile","finished_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_project_finished_idx" ON "audit_logs" USING btree ("project_id","finished_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_status_queued_idx" ON "audit_logs" USING btree ("status","queued_at");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_logs_pending_unique" ON "audit_logs" USING btree ("route_id","profile") WHERE "audit_logs"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "notifications_project_sent_idx" ON "notifications" USING btree ("project_id","sent_at" DESC NULLS LAST);