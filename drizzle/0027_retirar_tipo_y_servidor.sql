ALTER TABLE "projects" DROP COLUMN "kind";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "tech_label";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "includes_server";--> statement-breakpoint
DROP TYPE "public"."project_kind";