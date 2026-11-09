ALTER TABLE "mcp_api_keys" ADD COLUMN "all_access" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_api_keys" ADD COLUMN "client_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_api_keys" ADD COLUMN "project_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;