import type { Ga4Row } from "./ga4";
import type { GscRecord } from "./gsc";
import { pagePath } from "./urls";

export type GscPageTotals = { clicks: number; impressions: number };
export type Ga4PageTotals = { sessions: number; users: number };

/** Suma de GSC por página normalizada. Necesita la dimensión `page`. */
export function gscByPage(records: GscRecord[]): Map<string, GscPageTotals> {
  const out = new Map<string, GscPageTotals>();
  for (const r of records) {
    const key = pagePath(r.keys.page ?? "");
    const e = out.get(key) ?? { clicks: 0, impressions: 0 };
    e.clicks += r.clicks;
    e.impressions += r.impressions;
    out.set(key, e);
  }
  return out;
}

/** Suma de GA4 por página normalizada. Necesita la dimensión `pagePath`. */
export function ga4ByPage(rows: Ga4Row[]): Map<string, Ga4PageTotals> {
  const out = new Map<string, Ga4PageTotals>();
  for (const r of rows) {
    const key = pagePath(r.dims.pagePath ?? "");
    const e = out.get(key) ?? { sessions: 0, users: 0 };
    e.sessions += r.metrics.sessions ?? 0;
    e.users += r.metrics.totalUsers ?? 0;
    out.set(key, e);
  }
  return out;
}

export type Coverage = {
  gscPages: number;
  ga4Pages: number;
  inBoth: number;
  onlyGsc: number;
  onlyGa4: number;
  /** Parte de los clics de GSC que cae en páginas que también aparecen en GA4 (0 a 1). */
  gscClicksShareInGa4: number;
  /** Parte de las sesiones de GA4 que cae en páginas que también aparecen en GSC (0 a 1). */
  ga4SessionsShareInGsc: number;
};

/** Cuánto se pueden cruzar GSC y GA4 por página tras normalizar las URL. */
export function coverage(gsc: Map<string, GscPageTotals>, ga4: Map<string, Ga4PageTotals>): Coverage {
  let inBoth = 0;
  let gscClicks = 0;
  let gscClicksInBoth = 0;
  for (const [page, t] of gsc) {
    gscClicks += t.clicks;
    if (ga4.has(page)) {
      inBoth += 1;
      gscClicksInBoth += t.clicks;
    }
  }
  let ga4Sessions = 0;
  let ga4SessionsInBoth = 0;
  for (const [page, t] of ga4) {
    ga4Sessions += t.sessions;
    if (gsc.has(page)) ga4SessionsInBoth += t.sessions;
  }
  return {
    gscPages: gsc.size,
    ga4Pages: ga4.size,
    inBoth,
    onlyGsc: gsc.size - inBoth,
    onlyGa4: ga4.size - inBoth,
    gscClicksShareInGa4: gscClicks === 0 ? 0 : gscClicksInBoth / gscClicks,
    ga4SessionsShareInGsc: ga4Sessions === 0 ? 0 : ga4SessionsInBoth / ga4Sessions,
  };
}
