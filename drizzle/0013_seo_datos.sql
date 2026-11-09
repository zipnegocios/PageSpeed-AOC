CREATE TABLE "seo_ai_referrals_daily" (
	"project_id" uuid NOT NULL,
	"date" date NOT NULL,
	"source" text NOT NULL,
	"page" text NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	"users" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "seo_ai_referrals_daily_project_id_date_source_page_pk" PRIMARY KEY("project_id","date","source","page")
);
--> statement-breakpoint
CREATE TABLE "seo_search_daily" (
	"project_id" uuid NOT NULL,
	"date" date NOT NULL,
	"page" text NOT NULL,
	"country" text NOT NULL,
	"device" text NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"position_sum" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "seo_search_daily_project_id_date_page_country_device_pk" PRIMARY KEY("project_id","date","page","country","device")
);
--> statement-breakpoint
CREATE TABLE "seo_traffic_daily" (
	"project_id" uuid NOT NULL,
	"date" date NOT NULL,
	"page" text NOT NULL,
	"country" text NOT NULL,
	"channel" text NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	"users" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "seo_traffic_daily_project_id_date_page_country_channel_pk" PRIMARY KEY("project_id","date","page","country","channel")
);
--> statement-breakpoint
ALTER TABLE "seo_integrations" ADD COLUMN "synced_through" date;--> statement-breakpoint
ALTER TABLE "seo_integrations" ADD COLUMN "last_sync_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "seo_integrations" ADD COLUMN "sync_status" "seo_integration_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "seo_integrations" ADD COLUMN "sync_detail" text;--> statement-breakpoint
ALTER TABLE "seo_ai_referrals_daily" ADD CONSTRAINT "seo_ai_referrals_daily_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_search_daily" ADD CONSTRAINT "seo_search_daily_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_traffic_daily" ADD CONSTRAINT "seo_traffic_daily_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "seo_ai_referrals_daily_project_date_idx" ON "seo_ai_referrals_daily" USING btree ("project_id","date");--> statement-breakpoint
CREATE INDEX "seo_search_daily_project_date_idx" ON "seo_search_daily" USING btree ("project_id","date");--> statement-breakpoint
CREATE INDEX "seo_traffic_daily_project_date_idx" ON "seo_traffic_daily" USING btree ("project_id","date");