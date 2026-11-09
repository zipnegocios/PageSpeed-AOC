ALTER TABLE "admin_invites" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "admin_invites" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "admin_invites" ADD COLUMN "last_name" text;--> statement-breakpoint
ALTER TABLE "admin_invites" ADD COLUMN "avatar_key" text;--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "provisional_password" boolean DEFAULT false NOT NULL;