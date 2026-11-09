CREATE TYPE "public"."seo_crawl_status" AS ENUM('queued', 'running', 'succeeded', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."seo_crawl_trigger" AS ENUM('manual', 'scheduled');--> statement-breakpoint
CREATE TYPE "public"."seo_issue_severity" AS ENUM('error', 'warning', 'info');--> statement-breakpoint
CREATE TABLE "seo_crawl_issues" (
	"run_id" uuid NOT NULL,
	"page" text NOT NULL,
	"code" text NOT NULL,
	"severity" "seo_issue_severity" NOT NULL,
	"lang" text,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "seo_crawl_issues_run_id_page_code_pk" PRIMARY KEY("run_id","page","code")
);
--> statement-breakpoint
CREATE TABLE "seo_crawl_pages" (
	"run_id" uuid NOT NULL,
	"path" text NOT NULL,
	"status" integer NOT NULL,
	"final_path" text,
	"hops" integer DEFAULT 0 NOT NULL,
	"loop" boolean DEFAULT false NOT NULL,
	"content_type" text,
	"blocked_by_robots" boolean DEFAULT false NOT NULL,
	"in_sitemap" boolean DEFAULT false NOT NULL,
	"lang" text,
	"title" text,
	"description_length" integer,
	"h1_count" integer,
	"canonical" text,
	"html_lang" text,
	"robots" text[],
	"hreflang" jsonb,
	"jsonld_types" text[],
	"inlinks" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "seo_crawl_pages_run_id_path_pk" PRIMARY KEY("run_id","path")
);
--> statement-breakpoint
CREATE TABLE "seo_crawl_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"status" "seo_crawl_status" DEFAULT 'queued' NOT NULL,
	"trigger" "seo_crawl_trigger" NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"outcome" text,
	"detail" text,
	"pages_crawled" integer DEFAULT 0 NOT NULL,
	"pages_discovered" integer DEFAULT 0 NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"truncated_by" text,
	"limits" jsonb,
	"errors" integer DEFAULT 0 NOT NULL,
	"warnings" integer DEFAULT 0 NOT NULL,
	"infos" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "seo_crawl_issues" ADD CONSTRAINT "seo_crawl_issues_run_id_seo_crawl_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."seo_crawl_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_crawl_pages" ADD CONSTRAINT "seo_crawl_pages_run_id_seo_crawl_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."seo_crawl_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_crawl_runs" ADD CONSTRAINT "seo_crawl_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "seo_crawl_issues_run_code_idx" ON "seo_crawl_issues" USING btree ("run_id","code");--> statement-breakpoint
CREATE INDEX "seo_crawl_runs_project_queued_idx" ON "seo_crawl_runs" USING btree ("project_id","queued_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "seo_crawl_runs_active_unique" ON "seo_crawl_runs" USING btree ("project_id") WHERE "seo_crawl_runs"."status" in ('queued', 'running');