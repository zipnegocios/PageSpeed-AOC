/** Forma mínima del resultado de Lighthouse (`lhr`) que necesitamos; el resto se ignora. */
export type LhrLike = {
  lighthouseVersion?: string;
  finalDisplayedUrl?: string;
  finalUrl?: string;
  runtimeError?: { code?: string; message?: string };
  categories?: Record<
    string,
    | { title?: string; score?: number | null; auditRefs?: Array<{ id: string; weight?: number; group?: string }> }
    | undefined
  >;
  audits?: Record<
    string,
    | {
        numericValue?: number;
        title?: string;
        description?: string;
        displayValue?: string;
        scoreDisplayMode?: string;
        score?: number | null;
        details?: { type?: string; overallSavingsMs?: number; items?: Array<Record<string, unknown>> };
      }
    | undefined
  >;
};

export type AuditMetrics = {
  scorePerformance: number | null;
  scoreSeo: number | null;
  scoreAccessibility: number | null;
  scoreBestPractices: number | null;
  lcpMs: number | null;
  /** Como texto: la columna es numeric y el driver la devuelve así. */
  cls: string | null;
  tbtMs: number | null;
  fcpMs: number | null;
  ttfbMs: number | null;
  /** Lighthouse en modo navegación no mide INP (decisión D1). */
  inpMs: null;
  lighthouseVersion: string | null;
  finalUrl: string | null;
  httpStatus: number | null;
};

export type ExtractResult =
  | { ok: true; metrics: AuditMetrics }
  | { ok: false; code: string; message: string };

const toScore = (s: number | null | undefined): number | null =>
  typeof s === "number" && Number.isFinite(s) ? Math.max(0, Math.min(100, Math.round(s * 100))) : null;

const toMs = (v: number | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;

/** Extrae las puntuaciones y métricas del `lhr`. Si Lighthouse reportó un error de ejecución, no hay datos. */
export function extractResults(lhr: LhrLike): ExtractResult {
  if (lhr.runtimeError?.code) {
    return { ok: false, code: lhr.runtimeError.code, message: lhr.runtimeError.message ?? "" };
  }
  const c = lhr.categories ?? {};
  const scores = {
    scorePerformance: toScore(c.performance?.score),
    scoreSeo: toScore(c.seo?.score),
    scoreAccessibility: toScore(c.accessibility?.score),
    scoreBestPractices: toScore(c["best-practices"]?.score),
  };
  if (Object.values(scores).every((s) => s === null)) {
    return { ok: false, code: "INVALID_RESULT", message: "Lighthouse no devolvió puntuaciones." };
  }

  const a = lhr.audits ?? {};
  const cls = a["cumulative-layout-shift"]?.numericValue;
  const finalUrl = lhr.finalDisplayedUrl ?? lhr.finalUrl ?? null;
  const requests = a["network-requests"]?.details?.items ?? [];
  const document =
    requests.find((r) => r.resourceType === "Document" && r.url === finalUrl) ??
    requests.find((r) => r.resourceType === "Document") ??
    requests[0];
  const status = typeof document?.statusCode === "number" ? document.statusCode : null;

  return {
    ok: true,
    metrics: {
      ...scores,
      lcpMs: toMs(a["largest-contentful-paint"]?.numericValue),
      cls: typeof cls === "number" && Number.isFinite(cls) ? cls.toFixed(4) : null,
      tbtMs: toMs(a["total-blocking-time"]?.numericValue),
      fcpMs: toMs(a["first-contentful-paint"]?.numericValue),
      ttfbMs: toMs(a["server-response-time"]?.numericValue),
      inpMs: null,
      lighthouseVersion: lhr.lighthouseVersion ?? null,
      finalUrl,
      httpStatus: status,
    },
  };
}

export type Opportunity = { id: string; title: string; savingsMs: number };

/** Mejoras con ahorro estimado, de mayor a menor. Para la pantalla de detalle. */
export function topOpportunities(lhr: LhrLike, limit = 5): Opportunity[] {
  return Object.entries(lhr.audits ?? {})
    .flatMap(([id, audit]) => {
      const savings = audit?.details?.type === "opportunity" ? audit.details.overallSavingsMs : undefined;
      return audit && typeof savings === "number" && savings > 0
        ? [{ id, title: audit.title ?? id, savingsMs: Math.round(savings) }]
        : [];
    })
    .sort((x, y) => y.savingsMs - x.savingsMs)
    .slice(0, limit);
}
