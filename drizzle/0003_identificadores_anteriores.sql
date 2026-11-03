ALTER TABLE "clients" ADD COLUMN "slug_aliases" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "slug_aliases" text[] DEFAULT '{}'::text[] NOT NULL;