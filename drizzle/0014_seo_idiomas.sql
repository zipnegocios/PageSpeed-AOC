CREATE TABLE "seo_markets" (
	"project_id" uuid NOT NULL,
	"lang" text NOT NULL,
	"prefix" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seo_markets_project_id_lang_pk" PRIMARY KEY("project_id","lang"),
	CONSTRAINT "seo_markets_project_prefix_unique" UNIQUE("project_id","prefix")
);
--> statement-breakpoint
ALTER TABLE "seo_markets" ADD CONSTRAINT "seo_markets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;