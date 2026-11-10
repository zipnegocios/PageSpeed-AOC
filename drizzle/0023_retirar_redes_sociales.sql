-- Lo de las redes sociales pasa a la tabla de fuentes (grupo «social»): una sola fuente de verdad para el reparto de visitas.
INSERT INTO "seo_source_daily" ("project_id", "date", "grp", "source", "page", "sessions", "users")
SELECT "project_id", "date", 'social', "network", "page", "sessions", "users" FROM "seo_social_daily"
ON CONFLICT DO NOTHING;--> statement-breakpoint
DROP TABLE "seo_social_daily" CASCADE;--> statement-breakpoint
-- Una sola vez: Search Console y GA4 vuelven a descargar los últimos 90 días en su próxima descarga, para llenar el reparto completo
-- de fuentes y las consultas de búsqueda de lo que ya pasó. La descarga reemplaza ventanas completas: es idempotente.
UPDATE "seo_integrations" SET "synced_through" = NULL WHERE "kind" IN ('ga4', 'gsc');
