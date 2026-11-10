import { computeChange } from "@/server/domain/history";
import type { ReportData } from "@/server/services/report";

/** Un PNG de 1×1 píxel válido: lo bastante real para que el PDF lo incruste. */
export const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

const DAY = 86_400_000;

type Overrides = Partial<ReportData> & { routes?: number; logo?: ReportData["logo"] };

/** Datos de informe completos para las pruebas de los dos PDF: `routes` páginas con ambos dispositivos, mejoras, SEO y evolución. */
export function reportData(kind: ReportData["kind"], o: Overrides = {}): ReportData {
  const now = new Date("2026-11-03T12:00:00Z");
  const n = o.routes ?? 4;
  const paths = Array.from({ length: n }, (_, i) => (i === 0 ? "/" : `/pagina-${i}`));
  const latest = paths.flatMap((path, i) =>
    (["mobile", "desktop"] as const).map((profile) => ({
      routeId: path, path, profile, auditId: `a-${i}-${profile}`, finishedAt: now, agentic: { passed: 3 + (i % 4), total: 8 },
      metrics: { lcpMs: 1800 + i * 90, cls: 0.02 + (i % 5) * 0.06, tbtMs: 80 + i * 12 },
      scores: { performance: 40 + ((i * 7) % 60), seo: 93, accessibility: 88, best_practices: 100 },
      changes: { performance: computeChange("performance", 70, 65), seo: null, accessibility: null, best_practices: null },
    })),
  );
  const titles = Object.fromEntries(paths.map((p, i) => [p, i === 0 ? "Inicio" : `Página número ${i}`]));
  const improvements = { v: 2 as const, categories: { performance: [{ id: "render-blocking-insight", title: "Bloquea", impact: { ms: 1900 } }, { id: "unused-javascript", title: "JS", impact: { bytes: 90_000 } }], accessibility: [{ id: "color-contrast", title: "Contraste", impact: { count: 3 } }], seo: [{ id: "meta-description", title: "Sin descripción", impact: { count: 1 } }] } };
  const base: ReportData = {
    kind, generatedAt: now, days: 30, from: new Date(now.getTime() - 30 * DAY), clientName: "Acme S.A.", contactName: "Ana", contactEmail: "ana@acme.test",
    projectId: "p", projectName: "Tienda ñandú", baseUrl: "https://acme.test", performanceThreshold: 80,
    latest,
    improvements: [{ routePath: "/", profile: "mobile", text: "Rendimiento 72 (mínimo 80)" }],
    charts: paths.slice(0, 3).map((path) => ({ routePath: path, profile: "mobile" as const, points: Array.from({ length: 12 }, (_, i) => ({ at: new Date(now.getTime() - (12 - i) * DAY), value: 60 + i })), ranges: [{ metric: "seo" as const, first: 90, last: 93, min: 90, max: 93 }] })),
    logo: { bytes: TINY_PNG, bg: "#0B3D91" },
    titles,
    pageImprovements: { total: 2, pages: [{ path: "/", title: "Inicio", blocks: [{ profile: "mobile", kind: "threshold", category: "performance", value: 72, threshold: 80, auditId: "a-0-mobile", items: [{ id: "render-blocking-insight", text: "Hay archivos que retrasan que la página empiece a verse", impact: "≈ 1,9 s" }, { id: "x", text: "Otra causa", impact: "" }] }, { profile: "desktop", kind: "audit_failure", category: null, value: null, threshold: null, auditId: null, items: [] }] }] },
    seo: {
      days: 28,
      titles: { "/": "Inicio" },
      dashboard: {
        range: { from: "2026-10-06", to: "2026-11-02", days: 28 }, previous: { from: "2026-09-08", to: "2026-10-05" }, sync: { gsc: null, ga4: null }, markets: [], lang: null, languages: null,
        search: { range: { from: "2026-10-06", to: "2026-11-02", days: 28 }, previous: { from: "2026-09-08", to: "2026-10-05", days: 28 }, totals: { clicks: 4689, impressions: 140670, ctr: 0.033, position: 7 }, previousTotals: { clicks: 4000, impressions: 130000, ctr: 0.03, position: 7.5 }, daily: [], topPages: [{ page: "/", clicks: 1669, impressions: 50000, ctr: 0.03, position: 6 }], countries: [{ country: "col", name: "Colombia", clicks: 3000, impressions: 90000 }], devices: [{ device: "MOBILE", label: "Móvil", clicks: 3500, impressions: 100000 }], topQueries: [{ query: "ingeniería civil bogotá", clicks: 320, impressions: 6400, position: 4.2 }, { query: "grúas torre alquiler", clicks: 210, impressions: 5000, position: 5.5 }] },
        traffic: { range: { from: "2026-10-06", to: "2026-11-02", days: 28 }, previous: { from: "2026-09-08", to: "2026-10-05", days: 28 }, totals: { sessions: 9394, users: 7000 }, previousTotals: { sessions: 9000, users: 6800 }, daily: [], channels: [], topPages: [{ page: "/", sessions: 3000, users: 2400 }], countries: [{ country: "Colombia", sessions: 4000, users: 3000 }] },
        ai: { totals: { sessions: 136, users: 100 }, previousTotals: { sessions: 120, users: 90 }, bySource: [{ source: "chatgpt.com", sessions: 90, users: 70 }], topPages: [], daily: [] },
        sources: { range: { from: "2026-10-06", to: "2026-11-02", days: 28 }, previous: { from: "2026-09-08", to: "2026-10-05", days: 28 }, totals: { sessions: 9394, users: 7000 }, previousTotals: { sessions: 9000, users: 6800 }, groups: [{ group: "search", label: "Buscadores", sessions: 3600, previousSessions: 3300 }, { group: "social", label: "Redes sociales", sessions: 2900, previousSessions: 2500 }, { group: "direct", label: "Directo o sin identificar", sessions: 1800, previousSessions: 2000 }, { group: "referral", label: "Otros sitios", sessions: 1094, previousSessions: 1200 }], top: [], items: [{ group: "search", key: "google", label: "Google", sessions: 3400 }, { group: "social", key: "instagram", label: "Instagram", sessions: 1500 }, { group: "social", key: "whatsapp", label: "WhatsApp", sessions: 900 }, { group: "social", key: "facebook", label: "Facebook", sessions: 500 }, { group: "referral", key: "elcolombiano.com", label: "elcolombiano.com", sessions: 700 }] },
        social: { range: { from: "2026-10-06", to: "2026-11-02", days: 28 }, previous: { from: "2026-09-08", to: "2026-10-05", days: 28 }, totals: { sessions: 2900, users: 2000 }, previousTotals: { sessions: 2500, users: 1800 }, byNetwork: [{ network: "instagram", label: "Instagram", sessions: 1500, users: 1000 }, { network: "whatsapp", label: "WhatsApp", sessions: 900, users: 700 }, { network: "facebook", label: "Facebook", sessions: 500, users: 300 }], topPages: [] },
      } as never,
      health: {
        at: now, pagesCrawled: 118, truncated: false, errors: 1, warnings: 1, changes: { added: 1, resolved: 0 },
        groups: [{ group: "contenido", label: "Contenido", hint: "Títulos y descripciones.", errors: 1, warnings: 1, issues: [{ code: "title_missing", severity: "error", text: "Páginas sin título", pages: 1, added: 1, rows: [{ page: "/pagina-1", title: "Página número 1", evidence: { empty: false } }], more: 0 }, { code: "description_missing", severity: "warning", text: "Páginas sin descripción para los buscadores", pages: 2, added: 0, rows: [], more: 2 }] }],
      },
    },
    fields: [
      { assessment: "failed", device: "mobile", first: "2026-10-06", last: "2026-11-02", metrics: [
        { metric: "lcp", core: true, label: "LCP (contenido principal)", value: "2.9 s", rating: "needs-improvement", good: 60, needsImprovement: 30, poor: 10 },
        { metric: "inp", core: true, label: "INP (respuesta a la interacción)", value: "180 ms", rating: "good", good: 82, needsImprovement: 12, poor: 6 },
        { metric: "cls", core: true, label: "CLS (desplazamiento)", value: "0.030", rating: "good", good: 92, needsImprovement: 6, poor: 2 },
        { metric: "ttfb", core: false, label: "TTFB (respuesta del servidor)", value: "620 ms", rating: "good", good: 78, needsImprovement: 15, poor: 7 },
      ] },
    ],
    states: { speed: "included", improvements: "included", field: "included", search: "included", traffic: "included", sources: "included", ai: "pending", health: "included" },
    daily: Array.from({ length: 12 }, (_, i) => ({ day: new Date(now.getTime() - (12 - i) * DAY).toISOString().slice(0, 10), value: 60 + i })),
    detail: latest.slice(0, 60).map((l) => ({ routeId: l.routeId, path: l.path, profile: l.profile, scores: l.scores, metrics: l.metrics, agentic: l.agentic, improvements })),
    lighthouseVersion: "13.6.0",
    thresholds: [{ metric: "performance", minScore: 80 }, { metric: "seo", minScore: 90 }],
  };
  return { ...base, ...o, kind } as ReportData;
}
