import type { LhrLike } from "./score-extraction";

export const AGENTIC_CATEGORY = "agentic-browsing";

/** Misma regla que el informe de Lighthouse para "pasa" (informativas y con error no cuentan como superadas). */
export function showAsPassed(audit: { scoreDisplayMode?: string; score?: number | null } | undefined): boolean {
  switch (audit?.scoreDisplayMode) {
    case "manual":
    case "notApplicable":
      return true;
    case "error":
    case "informative":
      return false;
    default:
      return Number(audit?.score) >= 0.9;
  }
}

export type CategoryFraction = { passed: number; total: number };

/**
 * Fracción de comprobaciones superadas de una categoría que se puntúa así (la de agentes). Replica
 * `ReportUtils.calculateCategoryFraction`: no cuenta las ocultas, manuales, no aplicables ni informativas.
 * null si la categoría no vino en el resultado.
 */
export function categoryFraction(lhr: LhrLike, categoryId = AGENTIC_CATEGORY): CategoryFraction | null {
  const category = lhr.categories?.[categoryId];
  if (!category?.auditRefs) return null;
  let passed = 0;
  let total = 0;
  for (const ref of category.auditRefs) {
    const audit = lhr.audits?.[ref.id];
    if (!audit || ref.group === "hidden") continue;
    if (audit.scoreDisplayMode === "manual" || audit.scoreDisplayMode === "notApplicable" || audit.scoreDisplayMode === "informative") continue;
    total++;
    if (showAsPassed(audit)) passed++;
  }
  return { passed, total };
}
