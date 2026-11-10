import type { LhrLike } from "./score-extraction";

/**
 * Lo que hay que mejorar en una página, leído del resultado de Lighthouse al terminar la auditoría y guardado aparte: así el
 * portal no abre el JSON completo (cientos de KB en R2) cada vez que alguien mira la pestaña «Mejoras».
 */
export type ImprovementCategory = "performance" | "accessibility" | "seo" | "best-practices";
export const IMPROVEMENT_CATEGORIES: readonly ImprovementCategory[] = ["performance", "accessibility", "seo", "best-practices"];

export type ImprovementImpact = {
  /** Ahorro estimado de tiempo, en milisegundos. */
  ms?: number;
  /** Ahorro estimado de peso, en bytes. */
  bytes?: number;
  /** Cuántos elementos de la página lo incumplen. */
  count?: number;
};

export type ImprovementItem = {
  /** Identificador de la comprobación de Lighthouse (`unused-javascript`, `color-contrast`…). */
  id: string;
  /** Título de Lighthouse ya en español: respaldo cuando el glosario no tiene la comprobación. */
  title: string;
  impact: ImprovementImpact | null;
};

/**
 * `v: 2` guarda hasta `MAX_ITEMS_PER_CATEGORY` causas por rubro. `v: 1` (anterior) guardaba solo 10: se lee como respaldo, pero se vuelve a
 * calcular desde el resultado de Lighthouse en cuanto se pueda (ver `loadAuditImprovements`).
 */
export type AuditImprovements = { v: 1 | 2; categories: Partial<Record<ImprovementCategory, ImprovementItem[]>> };

/** Cuántas se guardan por rubro (el portal enseña las 5 primeras y deja «ver las restantes»). Antes eran 10 y se cortaba lo demás. */
export const MAX_ITEMS_PER_CATEGORY = 50;

/** Los grupos de comprobaciones de rendimiento que se pueden accionar (no las métricas ni lo oculto). */
const ACTIONABLE_GROUPS = new Set(["load-opportunities", "diagnostics", "insights"]);

/** Comprobaciones que no se cumplen: binarias con menos de 1; numéricas y de ahorro, por debajo de 0,9. Lo demás se ignora. */
function fails(mode: string | undefined, score: number | null | undefined): boolean {
  if (typeof score !== "number") return false;
  if (mode === "binary") return score < 1;
  if (mode === "numeric" || mode === "metricSavings") return score < 0.9;
  return false;
}

type Audit = NonNullable<NonNullable<LhrLike["audits"]>[string]>;

function impactOf(audit: Audit): ImprovementImpact | null {
  const d = audit.details as { overallSavingsMs?: number; overallSavingsBytes?: number; items?: unknown[] } | undefined;
  const savings = audit.metricSavings;
  const ms = Math.max(d?.overallSavingsMs ?? 0, ...Object.values(savings ?? {}).filter((v) => typeof v === "number"));
  const bytes = d?.overallSavingsBytes ?? 0;
  const count = Array.isArray(d?.items) ? d.items.length : 0;
  const impact: ImprovementImpact = {};
  if (ms > 0) impact.ms = Math.round(ms);
  if (bytes > 0) impact.bytes = Math.round(bytes);
  if (count > 0) impact.count = count;
  return Object.keys(impact).length > 0 ? impact : null;
}

/**
 * Las comprobaciones que fallan por rubro, de más a menos importante. Rendimiento: las que dan un ahorro o un diagnóstico
 * (no las métricas), por ahorro de tiempo. El resto: las que suman a la nota, por peso. Lógica pura sobre el JSON de Lighthouse.
 */
export function extractImprovements(lhr: LhrLike, limit = MAX_ITEMS_PER_CATEGORY): AuditImprovements {
  const categories: AuditImprovements["categories"] = {};
  for (const category of IMPROVEMENT_CATEGORIES) {
    const cat = lhr.categories?.[category];
    if (!cat) continue;
    const found: Array<{ item: ImprovementItem; weight: number; score: number }> = [];
    for (const ref of cat.auditRefs ?? []) {
      const audit = lhr.audits?.[ref.id];
      if (!audit || !fails(audit.scoreDisplayMode, audit.score)) continue;
      const wanted = category === "performance" ? ACTIONABLE_GROUPS.has(ref.group ?? "") : Boolean(ref.weight && ref.weight > 0);
      if (!wanted) continue;
      found.push({ item: { id: ref.id, title: (audit.title ?? ref.id).replace(/`/g, ""), impact: impactOf(audit) }, weight: ref.weight ?? 0, score: audit.score as number });
    }
    found.sort((a, b) =>
      category === "performance"
        ? (b.item.impact?.ms ?? 0) - (a.item.impact?.ms ?? 0) || a.score - b.score
        : b.weight - a.weight || a.score - b.score,
    );
    if (found.length > 0) categories[category] = found.slice(0, limit).map((f) => f.item);
  }
  return { v: 2, categories };
}

const hasCategories = (value: unknown) => typeof value === "object" && value !== null && typeof (value as { categories?: unknown }).categories === "object";

/** ¿Es un resumen guardado de la versión actual (hasta 50 causas por rubro)? El JSON de la base es de confianza, pero puede ser de otra versión. */
export function isAuditImprovements(value: unknown): value is AuditImprovements {
  return hasCategories(value) && (value as { v?: unknown }).v === 2;
}

/** ¿Es un resumen de la versión anterior (solo 10 causas por rubro)? Sirve de respaldo mientras no se pueda recalcular. */
export function isLegacyImprovements(value: unknown): value is AuditImprovements {
  return hasCategories(value) && (value as { v?: unknown }).v === 1;
}

const ALERT_METRIC_TO_CATEGORY = { performance: "performance", seo: "seo", accessibility: "accessibility", best_practices: "best-practices" } as const;
export const categoryOfMetric = (metric: keyof typeof ALERT_METRIC_TO_CATEGORY): ImprovementCategory => ALERT_METRIC_TO_CATEGORY[metric];
