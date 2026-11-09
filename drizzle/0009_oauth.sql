CREATE TABLE "oauth_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"redirect_uris" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "oauth_codes" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"key_name" text NOT NULL,
	"scopes" text[] NOT NULL,
	"all_access" boolean NOT NULL,
	"client_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"project_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "mcp_api_keys" ADD COLUMN "oauth_client_id" uuid;--> statement-breakpoint
ALTER TABLE "mcp_api_keys" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mcp_api_keys" ADD COLUMN "refresh_hash" text;--> statement-breakpoint
ALTER TABLE "mcp_api_keys" ADD COLUMN "prev_refresh_hash" text;--> statement-breakpoint
ALTER TABLE "mcp_api_keys" ADD COLUMN "refresh_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mcp_api_keys" ADD CONSTRAINT "mcp_api_keys_refresh_hash_unique" UNIQUE("refresh_hash");