CREATE TABLE "team_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"project_id" uuid,
	"granted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_api_keys" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "team_shares" ADD CONSTRAINT "team_shares_admin_id_admin_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_shares" ADD CONSTRAINT "team_shares_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_shares" ADD CONSTRAINT "team_shares_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_shares_client_uniq" ON "team_shares" USING btree ("admin_id","client_id") WHERE "team_shares"."project_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "team_shares_project_uniq" ON "team_shares" USING btree ("admin_id","project_id") WHERE "team_shares"."project_id" is not null;--> statement-breakpoint
CREATE INDEX "team_shares_admin_idx" ON "team_shares" USING btree ("admin_id");