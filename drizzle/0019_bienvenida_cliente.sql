CREATE TYPE "public"."project_kind" AS ENUM('site', 'shop', 'app');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'welcome';--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "cc_contacts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "welcome_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "kind" "project_kind" DEFAULT 'site' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "tech_label" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "includes_server" boolean DEFAULT false NOT NULL;