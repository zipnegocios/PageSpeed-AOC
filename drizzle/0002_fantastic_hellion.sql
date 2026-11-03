CREATE TABLE "field_data" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"target" text NOT NULL,
	"route_id" uuid,
	"form_factor" "audit_profile" NOT NULL,
	"status" text NOT NULL,
	"metrics" jsonb,
	"collection_first" text,
	"collection_last" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_data_unique" UNIQUE("project_id","target","form_factor"),
	CONSTRAINT "field_data_status" CHECK ("field_data"."status" in ('ok', 'no_data'))
);
--> statement-breakpoint
ALTER TABLE "field_data" ADD CONSTRAINT "field_data_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_data" ADD CONSTRAINT "field_data_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE cascade ON UPDATE no action;