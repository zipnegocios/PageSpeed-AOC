CREATE TABLE "seo_social_daily" (
	"project_id" uuid NOT NULL,
	"date" date NOT NULL,
	"network" text NOT NULL,
	"page" text NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	"users" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "seo_social_daily_project_id_date_network_page_pk" PRIMARY KEY("project_id","date","network","page")
);
--> statement-breakpoint
ALTER TABLE "seo_social_daily" ADD CONSTRAINT "seo_social_daily_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "seo_social_daily_project_date_idx" ON "seo_social_daily" USING btree ("project_id","date");
--> statement-breakpoint
-- Una sola vez: las conexiones de GA4 vuelven a descargar los últimos 90 días en su próxima descarga, para llenar las redes
-- sociales de lo que ya pasó (sin esto solo se llenarían los últimos días). La descarga reemplaza ventanas completas: es idempotente.
UPDATE "seo_integrations" SET "synced_through" = NULL WHERE "kind" = 'ga4';
