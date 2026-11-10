CREATE TABLE "seo_query_daily" (
	"project_id" uuid NOT NULL,
	"date" date NOT NULL,
	"query" text NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"position_sum" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "seo_query_daily_project_id_date_query_pk" PRIMARY KEY("project_id","date","query")
);
--> statement-breakpoint
CREATE TABLE "seo_source_daily" (
	"project_id" uuid NOT NULL,
	"date" date NOT NULL,
	"grp" text NOT NULL,
	"source" text NOT NULL,
	"page" text NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	"users" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "seo_source_daily_project_id_date_grp_source_page_pk" PRIMARY KEY("project_id","date","grp","source","page")
);
--> statement-breakpoint
ALTER TABLE "seo_query_daily" ADD CONSTRAINT "seo_query_daily_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_source_daily" ADD CONSTRAINT "seo_source_daily_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "seo_query_daily_project_date_idx" ON "seo_query_daily" USING btree ("project_id","date");--> statement-breakpoint
CREATE INDEX "seo_source_daily_project_date_idx" ON "seo_source_daily" USING btree ("project_id","date");