import type { LhrLike } from "./score-extraction";

export type CategoryKey = "performance" | "accessibility" | "seo" | "best-practices";

export type FailedCheck = {
  id: string;
  title: string;
  /** Explicación en texto plano (sin la sintaxis de enlaces de Lighthouse). */
  description: string;
  /** Primer enlace "Más información" de la explicación, si lo hay. */
  learnMoreUrl: string | null;
  displayValue: string | null;
  /** 0 a 1, tal como lo da Lighthouse. */
  score: number;
  weight: number;
};

export type CategoryChecks = {
  category: CategoryKey;
  label: string;
  /** 0 a 100, o null si Lighthouse no la calculó. */
  score: number | null;
  checks: FailedCheck[];
  /** Cuántas fallan en total (puede ser mayor que `checks` si se recortó). */
  failedCount: number;
};

const CATEGORIES: ReadonlyArray<[CategoryKey, string]> = [
  ["performance", "Rendimiento"],
  ["accessibility", "Accesibilidad"],
  ["seo", "SEO"],
  ["best-practices", "Buenas prácticas"],
];

const MARKDOWN_LINK = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/;

/** "Texto. [Más información](https://x)." -> { text: "Texto. Más información.", url: "https://x" } */
export function plainDescription(markdown: string | undefined): { text: string; url: string | null } {
  if (!markdown) return { text: "", url: null };
  const url = MARKDOWN_LINK.exec(markdown)?.[2] ?? null;
  const text = markdown
    .replace(/\[([^\]]+)\]\((?:https?:\/\/)[^)\s]+\)/g, "$1")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return { text, url };
}

/** Los criterios de Lighthouse: binario falla con 0; numérico, por debajo de 0,9. */
function fails(mode: string | undefined, score: number | null | undefined): score is number {
  if (typeof score !== "number") return false;
  if (mode === "binary") return score < 1;
  if (mode === "numeric") return score < 0.9;
  return false;
}

/**
 * Comprobaciones que no se cumplen, por categoría: las que suman a la puntuación (peso > 0), de
 * mayor a menor peso. En rendimiento solo salen las métricas; las mejoras con ahorro de tiempo se
 * muestran aparte. Las que no aplican, no se pudieron medir o son informativas se ignoran.
 */
export function failedChecks(lhr: LhrLike, limitPerCategory = 10): CategoryChecks[] {
  return CATEGORIES.flatMap(([category, label]) => {
    const cat = lhr.categories?.[category];
    if (!cat) return [];
    const all: FailedCheck[] = [];
    for (const ref of cat.auditRefs ?? []) {
      const audit = lhr.audits?.[ref.id];
      if (!audit || !(ref.weight && ref.weight > 0) || !fails(audit.scoreDisplayMode, audit.score)) continue;
      const { text, url } = plainDescription(audit.description);
      all.push({
        id: ref.id,
        title: (audit.title ?? ref.id).replace(/`/g, ""),
        description: text,
        learnMoreUrl: url,
        displayValue: audit.displayValue?.trim() ? audit.displayValue.trim() : null,
        score: audit.score as number,
        weight: ref.weight,
      });
    }
    all.sort((a, b) => b.weight - a.weight || a.score - b.score);
    const score = typeof cat.score === "number" ? Math.round(cat.score * 100) : null;
    return [{ category, label, score, checks: all.slice(0, limitPerCategory), failedCount: all.length }];
  });
}
