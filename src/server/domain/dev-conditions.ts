/**
 * Mejoras de un proyecto **en desarrollo**. En producción salen de las alertas abiertas, pero en desarrollo no se abren alertas (se suprimen);
 * como el cliente también ve estos proyectos, las mismas condiciones se calculan al vuelo: cada última auditoría (página y dispositivo) cuyo
 * rubro está por debajo de la meta configurada es una mejora. Lógica pura.
 */
export type Metric = "performance" | "seo" | "accessibility" | "best_practices";
export type ImprovementCondition = {
  routePath: string;
  profile: "mobile" | "desktop";
  kind: "threshold" | "audit_failure";
  /** Rubro por debajo de la meta (null en un fallo de auditoría). */
  metric: Metric | null;
  value: number | null;
  threshold: number | null;
  openedAt: Date;
};

const LABEL: Record<Metric, string> = { performance: "Rendimiento", seo: "SEO", accessibility: "Accesibilidad", best_practices: "Buenas prácticas" };
const ORDER: readonly Metric[] = ["performance", "accessibility", "seo", "best_practices"];

type Latest = { path: string; profile: "mobile" | "desktop"; finishedAt: Date; scores: Record<Metric, number | null> };
type Rule = { metric: Metric; minScore: number; enabled: boolean };

/** Las condiciones de mejora de las últimas auditorías contra las metas activas. Sin metas activas no hay mejoras (no hay contra qué comparar). */
export function developmentConditions(latest: readonly Latest[], thresholds: readonly Rule[]): ImprovementCondition[] {
  const active = ORDER.flatMap((m) => thresholds.filter((t) => t.enabled && t.metric === m));
  const out: ImprovementCondition[] = [];
  for (const l of latest) {
    for (const t of active) {
      const value = l.scores[t.metric];
      if (value !== null && value < t.minScore) out.push({ routePath: l.path, profile: l.profile, kind: "threshold", metric: t.metric, value, threshold: t.minScore, openedAt: l.finishedAt });
    }
  }
  return out;
}

/** «SEO 69 (mínimo 90)»: el mismo texto corto que las alertas. */
export const conditionSummary = (c: Pick<ImprovementCondition, "metric" | "value" | "threshold">): string => (c.metric ? `${LABEL[c.metric]} ${c.value} (mínimo ${c.threshold})` : "la auditoría falla");
