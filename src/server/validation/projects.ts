import { z } from "zod";
import { optionalText, requiredText } from "./common";

const phase = z.enum(["development", "production"], { error: "Fase no válida." });
const frequency = z.enum(["weekly", "daily"], { error: "Frecuencia no válida." });

export const projectInput = z.object({
  name: requiredText("El nombre", 2, 120),
  slug: optionalText(40),
  baseUrl: requiredText("La URL del sitio", 8, 300),
  phase: phase.default("development"),
  auditFrequency: frequency.default("weekly"),
  sitemapUrl: optionalText(500),
});

export const projectUpdateInput = z.object({
  name: requiredText("El nombre", 2, 120),
  baseUrl: requiredText("La URL del sitio", 8, 300),
  auditFrequency: frequency,
  sitemapUrl: optionalText(500),
  /** Hosts permitidos, uno por línea o separados por comas. */
  allowedHosts: optionalText(2000),
});

export const phaseInput = phase;

export type ProjectInput = z.infer<typeof projectInput>;
export type ProjectUpdateInput = z.infer<typeof projectUpdateInput>;

export const thresholdsInput = z
  .array(
    z.object({
      metric: z.enum(["performance", "seo", "accessibility", "best_practices"]),
      minScore: z.coerce
        .number({ error: "El umbral debe ser un número." })
        .int({ error: "El umbral debe ser un número entero." })
        .min(0, { error: "El umbral mínimo es 0." })
        .max(100, { error: "El umbral máximo es 100." }),
      enabled: z.boolean(),
    }),
  )
  .min(1)
  .max(4);

export type ThresholdsInput = z.infer<typeof thresholdsInput>;

export const routeInput = z.object({
  path: requiredText("La ruta", 1, 500),
  label: optionalText(120),
  requiresAuth: z.boolean().default(false),
});

export type RouteInput = z.infer<typeof routeInput>;
