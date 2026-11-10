CREATE TYPE "public"."report_kind" AS ENUM('weekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."report_send_status" AS ENUM('sent', 'failed', 'skipped');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'weekly';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'monthly';--> statement-breakpoint
CREATE TABLE "client_report_sends" (
	"project_id" uuid NOT NULL,
	"kind" "report_kind" NOT NULL,
	"period_key" text NOT NULL,
	"status" "report_send_status" NOT NULL,
	"detail" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_report_sends_project_id_kind_period_key_pk" PRIMARY KEY("project_id","kind","period_key")
);
--> statement-breakpoint
CREATE TABLE "project_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"happened_on" date NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "server_checks" (
	"project_id" uuid NOT NULL,
	"month" text NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "server_checks_project_id_month_pk" PRIMARY KEY("project_id","month")
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "report_weekly" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "report_monthly" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "client_report_sends" ADD CONSTRAINT "client_report_sends_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_actions" ADD CONSTRAINT "project_actions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_checks" ADD CONSTRAINT "server_checks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_actions_project_date_idx" ON "project_actions" USING btree ("project_id","happened_on");