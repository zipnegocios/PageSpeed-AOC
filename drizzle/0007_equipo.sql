CREATE TABLE "admin_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"kind" text DEFAULT 'invite' NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "admin_invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "role" text DEFAULT 'admin' NOT NULL;--> statement-breakpoint
CREATE INDEX "admin_invites_email_idx" ON "admin_invites" USING btree ("email");
--> statement-breakpoint
UPDATE "admin_users" SET "role" = 'owner' WHERE "id" = (SELECT "id" FROM "admin_users" ORDER BY "created_at" ASC LIMIT 1);
