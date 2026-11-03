ALTER TABLE "clients" ADD COLUMN "pin_hash" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "pin_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "pin_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "pin_requested_at" timestamp with time zone;