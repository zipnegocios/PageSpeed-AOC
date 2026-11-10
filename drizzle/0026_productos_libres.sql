ALTER TABLE "projects" ADD COLUMN "solutions" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "techs" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "services" text[] DEFAULT '{web,seo,security}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "initial_improvement" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Traspaso de lo que ya estaba guardado: el tipo (sitio, tienda, aplicación), la tecnología y si el plan incluía servidor.
UPDATE "projects" SET "solutions" = ARRAY[CASE "kind" WHEN 'shop' THEN 'tienda online' WHEN 'app' THEN 'aplicación' ELSE 'sitio web' END];--> statement-breakpoint
UPDATE "projects" SET "techs" = ARRAY[btrim("tech_label")] WHERE "tech_label" IS NOT NULL AND btrim("tech_label") <> '';--> statement-breakpoint
UPDATE "projects" SET "services" = ARRAY['web','seo','server','security'] WHERE "includes_server";
