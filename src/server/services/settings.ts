import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Database } from "@/server/db/client";
import { settings } from "@/server/db/schema";

export type Metric = "performance" | "seo" | "accessibility" | "best_practices";
export const METRICS: readonly Metric[] = ["performance", "seo", "accessibility", "best_practices"];

/** Umbrales iniciales de un proyecto nuevo (editables por proyecto). */
export const FALLBACK_THRESHOLDS: Record<Metric, number> = {
  performance: 80,
  seo: 90,
  accessibility: 90,
  best_practices: 90,
};

const thresholdsSchema = z.object({
  performance: z.number().int().min(0).max(100),
  seo: z.number().int().min(0).max(100),
  accessibility: z.number().int().min(0).max(100),
  best_practices: z.number().int().min(0).max(100),
});

export async function getDefaultThresholds(db: Database = getDb()): Promise<Record<Metric, number>> {
  const [row] = await db.select().from(settings).where(eq(settings.key, "default_thresholds")).limit(1);
  const parsed = thresholdsSchema.safeParse(row?.value);
  return parsed.success ? parsed.data : FALLBACK_THRESHOLDS;
}
