CREATE TYPE "public"."seo_integration_kind" AS ENUM('gsc', 'ga4', 'cloudflare');--> statement-breakpoint
CREATE TYPE "public"."seo_integration_status" AS ENUM('pending', 'ok', 'error');--> statement-breakpoint
CREATE TABLE "seo_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" "seo_integration_kind" NOT NULL,
	"external_id" text NOT NULL,
	"credential_enc" "bytea",
	"status" "seo_integration_status" DEFAULT 'pending' NOT NULL,
	"detail" text,
	"last_checked_at" timestamp with time zone,
	"last_ok_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seo_integrations_project_kind_unique" UNIQUE("project_id","kind")
);
--> statement-breakpoint
ALTER TABLE "seo_integrations" ADD CONSTRAINT "seo_integrations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;