import { eachDay } from "./dates";
import type { Ga4Row } from "./ga4";
import type { GscRecord } from "./gsc";
import type { Coverage } from "./join";
import type { LangSummary, Market } from "./lang";
import { summarizeRuns, type ProbeRun, type PromptSummary } from "./probe";

/**
 * Borrador del informe de hallazgos de la fase 0. Todo son funciones puras: `70-report.ts` lee los JSON y escribe el Markdown.
 * El informe solo lleva agregados (totales, conteos y porcentajes). No incluye consultas de búsqueda ni el nombre de la propiedad.
 */

export type Verdict = "cumple" | "no cumple" | "revisar a mano";

type CallSummary = { label: string; calls: number; totalMs: number; statuses: Record<string, number> };
type DateRange = { startDate: string; endDate: string };

/** Formas de los JSON que dejan los scripts 10 a 60. Todo es opcional: un archivo de otra versión no debe romper el informe. */
export type GscSummaryJson = {
  range?: DateRange;
  dataState?: string;
  rows?: number;
  requests?: number;
  truncated?: boolean;
  totals?: { clicks: number; impressions: number };
  pages?: number;
  countries?: number;
  lastDateWithData?: string | null;
  delayDays?: number | null;
  languages?: LangSummary;
  queryRows?: number;
  sitemaps?: number;
  inspected?: number;
  calls?: CallSummary[];
};

export type Ga4SummaryJson = {
  range?: DateRange;
  rows?: number;
  requests?: number;
  truncated?: boolean;
  sessions?: number;
  aiSessionsServerFilter?: number;
  aiSessionsLocalRegex?: number;
  directSessions?: number;
  aiSources?: Record<string, number>;
  pages?: number;
  pagesWithoutLanguage?: number;
  calls?: CallSummary[];
};

export type CfSummaryJson = {
  range?: DateRange;
  perDay?: Array<{ día: string; estado: string; solicitudes: number }>;
  byBot?: Record<string, { requests: number; bytes: number }>;
  pathsSample?: unknown;
  referralsSample?: unknown;
  calls?: CallSummary[];
};

export type CrawlSummaryJson = {
  sitemapUrls?: number;
  crawled?: number;
  failures?: Array<{ url: string; error: string }>;
  findings?: Array<{ url: string; hallazgo: string }>;
  avgMs?: number | null;
};

export type CrawlPageJson = { url?: string; status?: number; ms?: number };

export type CompareJson = {
  totals?: { gscClicks: number; gscImpressions: number; ga4Sessions: number; ga4Users: number };
  coverage?: Coverage;
};

/** Contenido de cada JSON de la carpeta de salida; `null` o ausente si el archivo no existe. */
export type ReportInputs = {
  /** Marca de tiempo ISO para el encabezado. Sin ella no se imprime fecha (útil en pruebas). */
  generatedAt?: string;
  markets?: Market[];
  defaultLang?: string;
  gscSummary?: GscSummaryJson | null;
  gscSearch?: GscRecord[] | null;
  gscQueries?: GscRecord[] | null;
  ga4Summary?: Ga4SummaryJson | null;
  ga4Report?: Ga4Row[] | null;
  ga4Ai?: Ga4Row[] | null;
  cfSummary?: CfSummaryJson | null;
  crawlSummary?: CrawlSummaryJson | null;
  crawlPages?: CrawlPageJson[] | null;
  probeSummary?: PromptSummary[] | null;
  probeRuns?: ProbeRun[] | null;
  compare?: CompareJson | null;
};

export type Finding = {
  n: number;
  title: string;
  verdict: Verdict;
  /** Por qué se propone ese veredicto, en una línea. */
  reason: string;
  evidence: Array<[label: string, value: string]>;
  /** Bloques Markdown extra (tablas, listas) que van bajo la evidencia. */
  blocks: string[];
};

// ---------- utilidades de formato ----------

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const sinDatos = (script: string): string => `sin datos: corre ${script}`;

const group = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/** Entero con punto de millares (es). */
export function fmtInt(x: number): string {
  const r = Math.round(x);
  return `${r < 0 ? "-" : ""}${group(String(Math.abs(r)))}`;
}

/** Decimal con coma (es). */
export function fmtDec(x: number, digits = 1): string {
  const [int = "0", dec] = Math.abs(x).toFixed(digits).split(".");
  return `${x < 0 ? "-" : ""}${group(int)}${dec ? `,${dec}` : ""}`;
}

/** Proporción 0 a 1 como porcentaje. */
export const pct = (ratio: number, digits = 1): string => `${fmtDec(ratio * 100, digits)} %`;

/** Texto seguro dentro de una celda de tabla Markdown. */
const cell = (value: string | number): string => String(value).replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");

function mdTable(headers: string[], rows: Array<Array<string | number>>): string {
  const head = `| ${headers.map(cell).join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  return [head, sep, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");
}

/** Días de una ventana, ambos extremos incluidos. null si las fechas no valen. */
function windowDays(range: DateRange | undefined): number | null {
  if (!range?.startDate || !range.endDate) return null;
  const n = eachDay(range.startDate, range.endDate).length;
  return n > 0 ? n : null;
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

/** Peor veredicto de un grupo: no cumple > revisar a mano > cumple. */
function worst(verdicts: Verdict[]): Verdict {
  if (verdicts.includes("no cumple")) return "no cumple";
  if (verdicts.includes("revisar a mano")) return "revisar a mano";
  return "cumple";
}

// ---------- las 11 preguntas ----------

function q1(i: ReportInputs): Finding {
  const describe = (calls: CallSummary[] | undefined) => {
    const c = calls?.find((x) => x.label === "oauth-token");
    if (!c) return "sin llamadas de token registradas";
    return `${fmtInt(c.calls)} llamada(s), estados ${JSON.stringify(c.statuses)}`;
  };
  return {
    n: 1,
    title: "¿La cuenta de servicio entra sin fricción?",
    verdict: "revisar a mano",
    reason: "La fricción del alta (pasos, permisos, tiempo) no se mide con los JSON; solo se confirma que las descargas funcionaron.",
    evidence: [
      ["GSC: la cuenta pudo descargar datos", i.gscSummary ? "sí (existe gsc-summary.json)" : sinDatos("10-gsc.ts")],
      ["GA4: la cuenta pudo descargar datos", i.ga4Summary ? "sí (existe ga4-summary.json)" : sinDatos("20-ga4.ts")],
      ["Token de acceso (GSC)", i.gscSummary ? describe(i.gscSummary.calls) : sinDatos("10-gsc.ts")],
      ["Token de acceso (GA4)", i.ga4Summary ? describe(i.ga4Summary.calls) : sinDatos("20-ga4.ts")],
      ["Resultado de 00-check.ts", "no deja JSON: pega aquí lo que imprimió (fuente, estado, detalle)"],
    ],
    blocks: [
      "Para anotar a mano: número de pasos del alta, minutos que tomó, permisos que hubo que pedir al cliente, errores de permisos (403) o de API sin habilitar.",
    ],
  };
}

function q2(i: ReportInputs): Finding {
  const s = i.gscSummary;
  const totals = s?.totals ?? (i.gscSearch ? { clicks: sum(i.gscSearch.map((r) => r.clicks)), impressions: sum(i.gscSearch.map((r) => r.impressions)) } : null);
  const rows = s?.rows ?? i.gscSearch?.length;
  const src = sinDatos("10-gsc.ts");
  return {
    n: 2,
    title: "¿Los totales de GSC por API coinciden con la interfaz?",
    verdict: "revisar a mano",
    reason: "La comparación exige abrir la interfaz de Search Console con el mismo periodo y filtros; aquí solo se muestran los totales de la API.",
    evidence: [
      ["Periodo", s?.range ? `${s.range.startDate} a ${s.range.endDate} (${windowDays(s.range) ?? "?"} días)` : src],
      ["Tipo de datos", s?.dataState ?? src],
      ["Clics (API)", totals ? fmtInt(totals.clicks) : src],
      ["Impresiones (API)", totals ? fmtInt(totals.impressions) : src],
      ["Filas descargadas", isNum(rows) ? fmtInt(rows) : src],
      ["Descarga truncada", s ? (s.truncated ? "sí: los totales son parciales" : "no") : src],
      ["Clics en la interfaz", "(anota aquí)"],
      ["Impresiones en la interfaz", "(anota aquí)"],
      ["Diferencia", "(anota aquí, en cifras y en %)"],
    ],
    blocks: [
      "Cómo comparar: Rendimiento > Resultados de búsqueda, mismo periodo, tipo Web, sin filtros y con datos finales. Los totales por fecha o por página deben cuadrar; al agrupar por consulta, GSC omite las anónimas.",
    ],
  };
}

function q3(i: ReportInputs): Finding {
  const s = i.gscSummary;
  const lang = s?.languages;
  const src = sinDatos("10-gsc.ts");
  const markets = (i.markets ?? []).map((m) => `${m.lang}=${m.prefix}`).join(", ");
  const config = `${markets || "(sin SPIKE_LANGS)"}${i.defaultLang ? ` · por defecto: ${i.defaultLang}` : ""}`;

  if (!s || !lang?.byLang || !s.totals) {
    return {
      n: 3,
      title: "¿El idioma sale del prefijo de la ruta?",
      verdict: "revisar a mano",
      reason: "Faltan datos de GSC para medir el reparto por idioma.",
      evidence: [
        ["Prefijos configurados", config],
        ["Páginas, clics e impresiones con idioma", src],
      ],
      blocks: [],
    };
  }

  const entries = Object.entries(lang.byLang);
  const idPages = sum(entries.map(([, v]) => v.pages));
  const idClicks = sum(entries.map(([, v]) => v.clicks));
  const idImpr = sum(entries.map(([, v]) => v.impressions));
  const viaDefault = sum(entries.map(([, v]) => v.viaDefault));
  const totalPages = idPages + lang.unmatchedCount;
  const share = (a: number, b: number) => (b > 0 ? a / b : 0);
  const pagesShare = share(idPages, totalPages);
  const clicksShare = share(idClicks, s.totals.clicks);
  const imprShare = share(idImpr, s.totals.impressions);
  const lowest = Math.min(pagesShare, clicksShare, imprShare);

  let verdict: Verdict;
  let reason: string;
  if (totalPages === 0) {
    verdict = "revisar a mano";
    reason = "No hay páginas en GSC para evaluar.";
  } else if (lowest >= 0.95) {
    verdict = "cumple";
    reason = "Al menos el 95 % de las páginas, clics e impresiones tiene idioma por prefijo.";
  } else if (lowest < 0.8) {
    verdict = "no cumple";
    reason = "Menos del 80 % de alguna medida (páginas, clics o impresiones) tiene idioma por prefijo.";
  } else {
    verdict = "revisar a mano";
    reason = "Entre el 80 % y el 95 % tiene idioma: revisa si lo que queda fuera importa.";
  }

  const unmatched = lang.unmatchedTop.slice(0, 5);
  const rest = lang.unmatchedCount - unmatched.length;
  const blocks = [
    mdTable(
      ["Idioma", "Páginas", "Clics", "Impresiones", "Sin prefijo (por defecto)"],
      entries.map(([l, v]) => [l, fmtInt(v.pages), fmtInt(v.clicks), fmtInt(v.impressions), fmtInt(v.viaDefault)]),
    ),
  ];
  if (unmatched.length > 0) {
    blocks.push(
      `Páginas sin idioma identificado, las ${unmatched.length} con más clics${rest > 0 ? ` (y ${fmtInt(rest)} más)` : ""}:\n\n${mdTable(
        ["Ruta", "Clics", "Impresiones"],
        unmatched.map((p) => [p.page, fmtInt(p.clicks), fmtInt(p.impressions)]),
      )}`,
    );
  }

  return {
    n: 3,
    title: "¿El idioma sale del prefijo de la ruta?",
    verdict,
    reason,
    evidence: [
      ["Prefijos configurados", config],
      ["Páginas con idioma", `${fmtInt(idPages)} de ${fmtInt(totalPages)} (${pct(pagesShare)})`],
      ["Clics con idioma", `${fmtInt(idClicks)} de ${fmtInt(s.totals.clicks)} (${pct(clicksShare)})`],
      ["Impresiones con idioma", `${fmtInt(idImpr)} de ${fmtInt(s.totals.impressions)} (${pct(imprShare)})`],
      ["Páginas que dependen del idioma por defecto", fmtInt(viaDefault)],
      ["Páginas sin idioma identificado", fmtInt(lang.unmatchedCount)],
      ["GA4: páginas sin idioma", i.ga4Summary ? fmtInt(i.ga4Summary.pagesWithoutLanguage ?? 0) : sinDatos("20-ga4.ts")],
    ],
    blocks,
  };
}

function q4(i: ReportInputs): Finding {
  const cov = i.compare?.coverage;
  const src = sinDatos("60-compare.ts");
  if (!cov) {
    return {
      n: 4,
      title: "¿GSC y GA4 se cruzan por página?",
      verdict: "revisar a mano",
      reason: "Falta compare.json.",
      evidence: [["Cobertura del cruce", src]],
      blocks: [],
    };
  }
  let verdict: Verdict;
  let reason: string;
  if (cov.gscClicksShareInGa4 >= 0.9) {
    verdict = "cumple";
    reason = "Al menos el 90 % de los clics de GSC cae en páginas que también están en GA4.";
  } else if (cov.gscClicksShareInGa4 < 0.7) {
    verdict = "no cumple";
    reason = "Menos del 70 % de los clics de GSC cae en páginas que también están en GA4.";
  } else {
    verdict = "revisar a mano";
    reason = "Entre el 70 % y el 90 % de los clics de GSC se cruza con GA4.";
  }
  return {
    n: 4,
    title: "¿GSC y GA4 se cruzan por página?",
    verdict,
    reason,
    evidence: [
      ["Páginas en GSC", fmtInt(cov.gscPages)],
      ["Páginas en GA4", fmtInt(cov.ga4Pages)],
      ["En ambas", fmtInt(cov.inBoth)],
      ["Solo en GSC", fmtInt(cov.onlyGsc)],
      ["Solo en GA4", fmtInt(cov.onlyGa4)],
      ["% de los clics de GSC en páginas con GA4", pct(cov.gscClicksShareInGa4)],
      ["% de las sesiones de GA4 en páginas con GSC", pct(cov.ga4SessionsShareInGsc)],
    ],
    blocks: [
      "El veredicto usa solo el primer porcentaje: GA4 también cuenta tráfico que no viene de buscadores, así que el segundo puede ser bajo sin que sea un fallo.",
    ],
  };
}

function q5(i: ReportInputs): Finding {
  const sources: Array<[string, CallSummary[] | undefined, string]> = [
    ["GSC", i.gscSummary?.calls, "10-gsc.ts"],
    ["GA4", i.ga4Summary?.calls, "20-ga4.ts"],
    ["Cloudflare", i.cfSummary?.calls, "30-cloudflare.ts"],
  ];
  const present = sources.filter(([, calls]) => calls !== undefined);
  const all = present.flatMap(([, calls]) => calls ?? []);
  const totalCalls = sum(all.map((c) => c.calls));
  const totalMs = sum(all.map((c) => c.totalMs));
  const quota = sum(all.map((c) => c.statuses?.["429"] ?? 0));
  const delay = i.gscSummary?.delayDays;

  let verdict: Verdict = "cumple";
  let reason = "Retraso de GSC razonable y sin respuestas 429.";
  if (present.length === 0 && !isNum(delay)) {
    verdict = "revisar a mano";
    reason = "No hay datos de llamadas ni de retraso.";
  } else if (isNum(delay) && delay > 7) {
    verdict = "no cumple";
    reason = `El último día con datos de GSC tiene ${delay} días de retraso (más de 7).`;
  } else if (quota > 0 || (isNum(delay) && delay > 4) || !isNum(delay)) {
    verdict = "revisar a mano";
    reason = quota > 0 ? `Hubo ${quota} respuesta(s) 429 (cuota): mira si los reintentos bastaron.` : !isNum(delay) ? "No se pudo medir el retraso de GSC." : `El retraso de GSC es de ${delay} días (más de 4).`;
  }

  const callRows = present.flatMap(([name, calls]) => (calls ?? []).map((c) => [name, c.label, fmtInt(c.calls), fmtInt(c.totalMs), JSON.stringify(c.statuses)] as Array<string>));
  const blocks = callRows.length > 0 ? [mdTable(["Fuente", "Llamada", "Llamadas", "ms totales", "Estados HTTP"], callRows)] : [];
  const truncated = [i.gscSummary?.truncated ? "GSC" : null, i.ga4Summary?.truncated ? "GA4" : null].filter(Boolean);

  return {
    n: 5,
    title: "¿Cuánto retraso, tiempo y cuota consumen las cargas?",
    verdict,
    reason,
    evidence: [
      ["Último día con datos en GSC", i.gscSummary ? (i.gscSummary.lastDateWithData ?? "ninguno") : sinDatos("10-gsc.ts")],
      ["Retraso de GSC (días)", isNum(delay) ? fmtInt(delay) : i.gscSummary ? "no medido" : sinDatos("10-gsc.ts")],
      ["Llamadas HTTP (todas las fuentes)", present.length > 0 ? fmtInt(totalCalls) : "sin datos: corre 10-gsc.ts, 20-ga4.ts y 30-cloudflare.ts"],
      ["Tiempo total en llamadas", present.length > 0 ? `${fmtInt(totalMs)} ms (≈ ${fmtDec(totalMs / 1000)} s)` : "sin datos"],
      ["Respuestas 429 (cuota)", present.length > 0 ? fmtInt(quota) : "sin datos"],
      ["Peticiones paginadas GSC / GA4", `${isNum(i.gscSummary?.requests) ? fmtInt(i.gscSummary.requests) : sinDatos("10-gsc.ts")} / ${isNum(i.ga4Summary?.requests) ? fmtInt(i.ga4Summary.requests) : sinDatos("20-ga4.ts")}`],
      ["Descargas truncadas", i.gscSummary || i.ga4Summary ? (truncated.length > 0 ? truncated.join(" y ") : "ninguna") : "sin datos"],
      ["URL inspeccionadas (cuota diaria aparte)", isNum(i.gscSummary?.inspected) ? fmtInt(i.gscSummary.inspected) : sinDatos("10-gsc.ts")],
    ],
    blocks,
  };
}

function q6(i: ReportInputs): Finding {
  const s = i.ga4Summary;
  const src = sinDatos("20-ga4.ts");
  if (!s || !isNum(s.sessions)) {
    return {
      n: 6,
      title: "¿GA4 muestra visitas desde chats de IA?",
      verdict: "revisar a mano",
      reason: "Falta ga4-summary.json.",
      evidence: [["Sesiones desde IA", src]],
      blocks: [],
    };
  }
  const ai = s.aiSessionsServerFilter ?? 0;
  const local = s.aiSessionsLocalRegex;
  const direct = s.directSessions;
  const sources = Object.entries(s.aiSources ?? {}).sort((a, b) => b[1] - a[1]);
  const days = windowDays(s.range);

  let verdict: Verdict;
  let reason: string;
  if (ai > 0) {
    verdict = "cumple";
    reason = "GA4 registra sesiones desde asistentes de IA en la ventana.";
  } else if (s.sessions === 0) {
    verdict = "revisar a mano";
    reason = "GA4 no registró sesiones en la ventana: no se puede concluir.";
  } else {
    verdict = "no cumple";
    reason = `Ninguna sesión desde asistentes de IA en ${days ?? "los"} días${days ? "" : " de la ventana"}; revisa si la ventana es corta o si el filtro de fuentes está incompleto.`;
  }
  const mismatch = isNum(local) && local !== ai;

  return {
    n: 6,
    title: "¿GA4 muestra visitas desde chats de IA?",
    verdict,
    reason,
    evidence: [
      ["Sesiones totales", fmtInt(s.sessions)],
      ["Sesiones desde IA (filtro del servidor)", fmtInt(ai)],
      ["Sesiones desde IA (regex local)", isNum(local) ? `${fmtInt(local)}${mismatch ? " (no coincide con el filtro del servidor: revisa)" : ""}` : "no medido"],
      ["% de las sesiones", s.sessions > 0 ? pct(ai / s.sessions, 2) : "n/d"],
      ["Sesiones directas", isNum(direct) ? fmtInt(direct) : "no medido"],
      ["IA frente a directo", isNum(direct) && direct > 0 ? `${pct(ai / direct, 2)} del tráfico directo` : "n/d"],
      ["Fuentes de IA distintas", fmtInt(sources.length)],
    ],
    blocks: sources.length > 0 ? [mdTable(["Fuente", "Sesiones"], sources.slice(0, 10).map(([name, n]) => [name, fmtInt(n)]))] : [],
  };
}

function q7(i: ReportInputs): Finding {
  const s = i.cfSummary;
  const src = sinDatos("30-cloudflare.ts");
  if (!s || !s.perDay) {
    return {
      n: 7,
      title: "¿Cloudflare distingue los bots de IA por agente?",
      verdict: "revisar a mano",
      reason: "Falta cf-summary.json (o no se configuró el token de Cloudflare).",
      evidence: [["Bots y solicitudes", src]],
      blocks: [],
    };
  }
  const perDay = s.perDay;
  const okDays = perDay.filter((d) => d.estado === "ok");
  const errDays = perDay.filter((d) => d.estado !== "ok");
  const errByState = new Map<string, number>();
  for (const d of errDays) errByState.set(d.estado, (errByState.get(d.estado) ?? 0) + 1);
  const bots = Object.entries(s.byBot ?? {}).sort((a, b) => b[1].requests - a[1].requests);
  const identified = bots.filter(([name, v]) => name !== "otro" && v.requests > 0);
  const other = s.byBot?.otro?.requests ?? 0;
  const botRequests = sum(identified.map(([, v]) => v.requests));

  let verdict: Verdict;
  let reason: string;
  if (perDay.length === 0) {
    verdict = "revisar a mano";
    reason = "No se consultó ningún día.";
  } else if (okDays.length === 0) {
    verdict = "no cumple";
    reason = "Ningún día respondió: el token o el plan no dan acceso a estas analíticas.";
  } else if (identified.length === 0) {
    verdict = "revisar a mano";
    reason = "Hay respuestas, pero ningún bot de IA identificado por agente (puede ser que no hayan pasado).";
  } else if (errDays.length > 0) {
    verdict = "revisar a mano";
    reason = `Se distinguen ${identified.length} bots, pero ${errDays.length} de ${perDay.length} días fallan: el plan conserva menos historial que la ventana.`;
  } else {
    verdict = "cumple";
    reason = `Se distinguen ${identified.length} bots de IA por agente y todos los días respondieron.`;
  }

  const isList = (x: unknown): x is unknown[] => Array.isArray(x);
  const sample = (x: unknown) => (isList(x) ? `${x.length} filas` : x === undefined ? "no consultado" : "error (suele requerir plan de pago)");

  return {
    n: 7,
    title: "¿Cloudflare distingue los bots de IA por agente?",
    verdict,
    reason,
    evidence: [
      ["Días consultados", fmtInt(perDay.length)],
      ["Días con respuesta", fmtInt(okDays.length)],
      ["Días con error (historial del plan)", errDays.length > 0 ? `${fmtInt(errDays.length)}: ${[...errByState].map(([e, n]) => `${e} ×${n}`).join(", ")}` : "0"],
      ["Días con error, fechas", errDays.length > 0 ? errDays.slice(0, 10).map((d) => d.día).join(", ") : "ninguno"],
      ["Bots de IA identificados", fmtInt(identified.length)],
      ["Solicitudes de bots de IA", fmtInt(botRequests)],
      ["Solicitudes sin bot reconocido (\"otro\")", fmtInt(other)],
      ["Rutas más rastreadas (último día)", sample(s.pathsSample)],
      ["Referidos de asistentes (último día)", sample(s.referralsSample)],
    ],
    blocks: bots.length > 0 ? [mdTable(["Bot", "Solicitudes", "Bytes"], bots.slice(0, 15).map(([name, v]) => [name, fmtInt(v.requests), fmtInt(v.bytes)]))] : [],
  };
}

function q8(): Finding {
  return {
    n: 8,
    title: "¿Los informes de IA de GSC y Bing se pueden exportar de forma estable?",
    verdict: "revisar a mano",
    reason: "Ningún script del piloto consulta esos informes: se comprueba siempre a mano.",
    evidence: [
      ["Datos automáticos", "ninguno: no hay script del piloto para estos informes"],
      ["GSC: ¿hay API o solo exportación manual?", "(anota aquí)"],
      ["Bing Webmaster Tools: ¿hay API o solo exportación manual?", "(anota aquí)"],
      ["Formato y columnas de la exportación", "(anota aquí)"],
      ["¿Las columnas y el formato son los mismos entre dos exportaciones?", "(anota aquí)"],
      ["Ventana máxima y retraso", "(anota aquí)"],
      ["¿Requiere una sesión humana (no automatizable con cuenta de servicio)?", "(anota aquí)"],
    ],
    blocks: ["Haz dos exportaciones del mismo periodo con unos días de diferencia y compara columnas, formatos y cifras."],
  };
}

type PromptStat = { provider: string; lang: string; prompt: string; runs: number; mention: number; cited: number };

function q9(i: ReportInputs): Finding {
  const summary = i.probeSummary ?? (i.probeRuns ? summarizeRuns(i.probeRuns) : null);
  if (!summary || summary.length === 0) {
    return {
      n: 9,
      title: "¿El sondeo da una señal útil y repetible?",
      verdict: "revisar a mano",
      reason: "Falta probe-summary.json.",
      evidence: [["Tasas de mención y cita", sinDatos("50-probe.ts")]],
      blocks: [],
    };
  }
  const stats: PromptStat[] = summary.map((s) => ({ provider: s.provider, lang: s.lang, prompt: s.prompt, runs: s.runs, mention: s.mentionRate, cited: s.citedRate }));
  const sd = (p: number) => Math.sqrt(p * (1 - p));
  const unstable = stats.filter((s) => (s.mention > 0 && s.mention < 1) || (s.cited > 0 && s.cited < 1));
  const unstableShare = unstable.length / stats.length;
  const providers = [...new Set(stats.map((s) => s.provider))].sort();
  const realProviders = providers.filter((p) => p !== "mock");
  const anyMention = stats.some((s) => s.mention > 0);
  const anyCited = stats.some((s) => s.cited > 0);
  const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);
  const runs = stats.map((s) => s.runs);

  let verdict: Verdict;
  let reason: string;
  if (realProviders.length === 0) {
    verdict = "revisar a mano";
    reason = "Solo hay datos del proveedor simulado (mock): sirve para probar el flujo, no da señal.";
  } else if (!anyMention && !anyCited) {
    verdict = "revisar a mano";
    reason = "Ninguna pregunta produjo menciones ni citas: no se puede juzgar la señal.";
  } else if (unstableShare > 0.5) {
    verdict = "no cumple";
    reason = `${pct(unstableShare, 0)} de las preguntas no da el mismo resultado en todas las repeticiones.`;
  } else if (unstableShare <= 0.25) {
    verdict = "cumple";
    reason = `Hay menciones o citas y solo ${pct(unstableShare, 0)} de las preguntas varía entre repeticiones.`;
  } else {
    verdict = "revisar a mano";
    reason = `${pct(unstableShare, 0)} de las preguntas varía entre repeticiones (entre el 25 % y el 50 %).`;
  }

  const trunc = (s: string) => (s.length > 60 ? `${s.slice(0, 57)}…` : s);
  return {
    n: 9,
    title: "¿El sondeo da una señal útil y repetible?",
    verdict,
    reason,
    evidence: [
      ["Proveedores", providers.join(", ")],
      ["Preguntas (por proveedor)", fmtInt(stats.length)],
      ["Repeticiones por pregunta", Math.min(...runs) === Math.max(...runs) ? fmtInt(runs[0] ?? 0) : `${fmtInt(Math.min(...runs))} a ${fmtInt(Math.max(...runs))}`],
      ["Tasa media de mención", pct(avg(stats.map((s) => s.mention)))],
      ["Tasa media de cita", pct(avg(stats.map((s) => s.cited)))],
      ["Preguntas que varían entre repeticiones", `${fmtInt(unstable.length)} de ${fmtInt(stats.length)} (${pct(unstableShare, 0)})`],
      ["Dispersión media (desv. típica) mención / cita", `${fmtDec(avg(stats.map((s) => sd(s.mention))), 2)} / ${fmtDec(avg(stats.map((s) => sd(s.cited))), 2)}`],
    ],
    blocks: [
      mdTable(
        ["Idioma", "Proveedor", "Pregunta", "Rep.", "% mención", "% cita", "Desv. mención", "Desv. cita"],
        stats.slice(0, 20).map((s) => [s.lang, s.provider, trunc(s.prompt), s.runs, pct(s.mention, 0), pct(s.cited, 0), fmtDec(sd(s.mention), 2), fmtDec(sd(s.cited), 2)]),
      ),
      ...(stats.length > 20 ? [`(se muestran 20 de ${stats.length} preguntas)`] : []),
      "La desviación típica es la de una variable de sí/no repetida: raíz de p·(1−p). Vale 0 si todas las repeticiones coinciden y 0,5 si se reparten mitad y mitad.",
    ],
  };
}

/** Agrupa un hallazgo del rastreo por tipo, sin los datos variables (números, URL, idiomas). */
export function findingType(hallazgo: string): string {
  if (/^\d+ etiquetas h1$/.test(hallazgo)) return "h1 distinto de uno";
  if (/^\d+ bloque\(s\) JSON-LD/.test(hallazgo)) return "JSON-LD inválido";
  if (hallazgo.startsWith("lang=")) return "lang no coincide con el idioma de la ruta";
  if (hallazgo.startsWith("hreflang:")) {
    if (hallazgo.includes("falta reciprocidad")) return "hreflang: falta reciprocidad";
    if (hallazgo.includes("no se declara a sí misma")) return "hreflang: no se declara a sí misma";
    return "hreflang: otro";
  }
  return hallazgo;
}

function q10(i: ReportInputs): Finding {
  const s = i.crawlSummary;
  if (!s || !Array.isArray(s.findings)) {
    return {
      n: 10,
      title: "¿El rastreo mínimo encuentra hallazgos accionables?",
      verdict: "revisar a mano",
      reason: "Falta crawl-summary.json.",
      evidence: [["Hallazgos por tipo", sinDatos("40-crawl.ts")]],
      blocks: [],
    };
  }
  const findings = s.findings;
  const crawled = s.crawled ?? 0;
  const byType = new Map<string, number>();
  for (const f of findings) byType.set(findingType(f.hallazgo), (byType.get(findingType(f.hallazgo)) ?? 0) + 1);
  const rows = [...byType].sort((a, b) => b[1] - a[1]);
  const pagesWithFindings = new Set(findings.map((f) => f.url)).size;

  let verdict: Verdict;
  let reason: string;
  if (crawled === 0) {
    verdict = "no cumple";
    reason = "No se pudo rastrear ninguna página.";
  } else if (findings.length === 0) {
    verdict = "revisar a mano";
    reason = "El rastreo no encontró nada: puede ser un sitio sano o una extracción demasiado pobre.";
  } else {
    verdict = "cumple";
    reason = `El rastreo mínimo encontró ${fmtInt(findings.length)} hallazgos de ${rows.length} tipos distintos.`;
  }

  const notOk = i.crawlPages ? i.crawlPages.filter((p) => isNum(p.status) && p.status !== 200).length : null;
  return {
    n: 10,
    title: "¿El rastreo mínimo encuentra hallazgos accionables?",
    verdict,
    reason,
    evidence: [
      ["URL en el sitemap", isNum(s.sitemapUrls) ? fmtInt(s.sitemapUrls) : "no medido"],
      ["Páginas rastreadas", fmtInt(crawled)],
      ["Fallos de rastreo", fmtInt(s.failures?.length ?? 0)],
      ["Páginas con respuesta distinta de 200", notOk === null ? sinDatos("40-crawl.ts") : fmtInt(notOk)],
      ["Tiempo medio por página", isNum(s.avgMs) ? `${fmtInt(s.avgMs)} ms` : "no medido"],
      ["Hallazgos en total", fmtInt(findings.length)],
      ["Páginas con al menos un hallazgo", crawled > 0 ? `${fmtInt(pagesWithFindings)} de ${fmtInt(crawled)} (${pct(pagesWithFindings / crawled, 0)})` : "n/d"],
    ],
    blocks: rows.length > 0 ? [mdTable(["Tipo de hallazgo", "Conteo"], rows.map(([t, n]) => [t, fmtInt(n)]))] : [],
  };
}

function q11(i: ReportInputs): Finding {
  const gscDays = windowDays(i.gscSummary?.range);
  const ga4Days = windowDays(i.ga4Summary?.range);
  const cfDays = windowDays(i.cfSummary?.range) ?? (i.cfSummary?.perDay?.length || null);
  const gscRows = i.gscSummary?.rows ?? i.gscSearch?.length;
  const ga4Rows = i.ga4Summary?.rows ?? i.ga4Report?.length;
  const ga4AiRows = i.ga4Ai?.length;
  const queryRows = i.gscSummary?.queryRows ?? i.gscQueries?.length;

  // Cloudflare no deja filas: se estima una por bot y día con respuesta.
  const cf = i.cfSummary;
  const okDays = cf?.perDay?.filter((d) => d.estado === "ok").length ?? 0;
  const botKinds = cf?.byBot ? Object.keys(cf.byBot).length : 0;
  const botRows = cf?.perDay ? botKinds * okDays : null;

  const perDay = (rows: number | undefined | null, days: number | null): number | null => (isNum(rows) && days ? rows / days : null);
  const lines: Array<[string, number | null | undefined, number | null, number | null, string]> = [
    ["GSC: rendimiento (fecha, página, país, dispositivo)", gscRows, gscDays, perDay(gscRows, gscDays), ""],
    ["GA4: informe general", ga4Rows, ga4Days, perDay(ga4Rows, ga4Days), ""],
    ["GA4: sesiones desde IA", ga4AiRows, ga4Days, perDay(ga4AiRows, ga4Days), ""],
    ["Cloudflare: bots de IA", botRows, cfDays, perDay(botRows, cfDays), "estimado: un registro por bot y día"],
  ];
  const known = lines.filter((l) => l[3] !== null);
  const totalPerDay = sum(known.map((l) => l[3] ?? 0));
  const truncated = Boolean(i.gscSummary?.truncated || i.ga4Summary?.truncated);

  let verdict: Verdict;
  let reason: string;
  if (known.length === 0) {
    verdict = "revisar a mano";
    reason = "No hay filas ni ventanas para dimensionar.";
  } else if (truncated) {
    verdict = "revisar a mano";
    reason = "Alguna descarga se truncó: las filas por día son un mínimo, no la cifra real.";
  } else if (!i.gscSummary || !i.ga4Summary) {
    verdict = "revisar a mano";
    reason = "Falta GSC o GA4: el dimensionamiento está incompleto.";
  } else {
    verdict = "cumple";
    reason = "Con las filas y las ventanas de GSC y GA4 se puede dimensionar las tablas.";
  }

  const fmtOpt = (x: number | null | undefined, f: (n: number) => string): string => (isNum(x) ? f(x) : "sin datos");
  const blocks = [
    mdTable(
      ["Fuente", "Filas", "Días de la ventana", "Filas por día", "Nota"],
      lines.map(([name, rows, days, per, note]) => [name, fmtOpt(rows, fmtInt), fmtOpt(days, fmtInt), fmtOpt(per, (n) => fmtDec(n, 1)), note]),
    ),
  ];
  if (isNum(queryRows)) blocks.push(`GSC por página y consulta: ${fmtInt(queryRows)} filas para toda la ventana (con tope de descarga; no se divide por día).`);
  if (known.length > 0) blocks.push(`Suma de las fuentes con datos: ${fmtDec(totalPerDay, 1)} filas por día, unas ${fmtInt(totalPerDay * 365)} filas al año (referencia para tamaño y retención; ajusta si el sitio crece).`);

  return {
    n: 11,
    title: "¿Cuántas filas por día genera cada fuente?",
    verdict,
    reason,
    evidence: [
      ["Ventana de GSC (días)", fmtOpt(gscDays, fmtInt)],
      ["Ventana de GA4 (días)", fmtOpt(ga4Days, fmtInt)],
      ["Filas por día de GSC", fmtOpt(perDay(gscRows, gscDays), (n) => fmtDec(n, 1))],
      ["Filas por día de GA4", fmtOpt(perDay(ga4Rows, ga4Days), (n) => fmtDec(n, 1))],
      ["Filas por día de bots (estimadas)", fmtOpt(perDay(botRows, cfDays), (n) => fmtDec(n, 1))],
    ],
    blocks,
  };
}

/** Las 11 preguntas con su evidencia y veredicto propuesto. */
export function buildFindings(i: ReportInputs): Finding[] {
  return [q1(i), q2(i), q3(i), q4(i), q5(i), q6(i), q7(i), q8(), q9(i), q10(i), q11(i)];
}

// ---------- documento ----------

function renderFinding(f: Finding): string {
  const parts = [
    `## ${f.n}. ${f.title}`,
    `**Veredicto propuesto: ${f.verdict}.** ${f.reason}`,
    mdTable(["Evidencia", "Valor"], f.evidence),
    ...f.blocks,
    "**Notas:**\n\n&nbsp;",
  ];
  return parts.join("\n\n");
}

function goNoGo(f: Finding[]): string {
  const of = (...ns: number[]): string => {
    const v = worst(ns.map((n) => f.find((x) => x.n === n)?.verdict ?? "revisar a mano"));
    const hint = v === "cumple" ? "go probable" : v === "no cumple" ? "no-go probable" : "pendiente de revisión";
    return `sugerencia automática: ${hint} (${ns.length === 1 ? "pregunta" : "preguntas"} ${ns.join(", ")})`;
  };
  return [
    "## Decisión go / no-go",
    "Marca cada casilla cuando lo hayas decidido. La sugerencia automática sale de los veredictos de arriba y no sustituye tu criterio.",
    [
      `- [ ] Cuenta de servicio como modo de alta principal — ${of(1)}`,
      `- [ ] GSC y GA4 bastan para la fase 1 — ${of(2, 4, 5, 6)}`,
      `- [ ] Fuente de bots de IA a usar — ${of(7)}`,
      "  - [ ] Cloudflare (analíticas por GraphQL)",
      "  - [ ] Registros del servidor o del CDN",
      "  - [ ] Otra: ______",
      `- [ ] Idioma por prefijo de ruta suficiente — ${of(3)}`,
      `- [ ] Sondeo de IA: seguir — ${of(8, 9)}`,
      "  - Proveedores con los que seguir: ______",
      `- [ ] Dimensionamiento y retención de datos acordados — ${of(5, 11)}`,
      "  - Retención propuesta: ______",
    ].join("\n"),
    "**Notas:**\n\n&nbsp;",
  ].join("\n\n");
}

const FILES: Array<[keyof ReportInputs, string, string]> = [
  ["gscSummary", "gsc-summary.json", "10-gsc.ts"],
  ["gscSearch", "gsc-search.json", "10-gsc.ts"],
  ["gscQueries", "gsc-queries.json", "10-gsc.ts"],
  ["ga4Summary", "ga4-summary.json", "20-ga4.ts"],
  ["ga4Report", "ga4-report.json", "20-ga4.ts"],
  ["ga4Ai", "ga4-ai.json", "20-ga4.ts"],
  ["cfSummary", "cf-summary.json", "30-cloudflare.ts"],
  ["crawlSummary", "crawl-summary.json", "40-crawl.ts"],
  ["crawlPages", "crawl-pages.json", "40-crawl.ts"],
  ["probeSummary", "probe-summary.json", "50-probe.ts"],
  ["probeRuns", "probe-runs.json", "50-probe.ts"],
  ["compare", "compare.json", "60-compare.ts"],
];

/** Archivos de entrada que faltan y el script que los genera. */
export function missingInputs(i: ReportInputs): Array<{ file: string; script: string }> {
  return FILES.filter(([key]) => !i[key]).map(([, file, script]) => ({ file, script }));
}

/** Informe de hallazgos completo en Markdown. */
export function buildReport(inputs: ReportInputs): string {
  const findings = buildFindings(inputs);
  const missing = missingInputs(inputs);
  const date = inputs.generatedAt ? `Generado: ${inputs.generatedAt.slice(0, 10)}. ` : "";

  const header = [
    "# Informe de hallazgos · Fase 0 (borrador)",
    `${date}Borrador automático a partir de la salida de los scripts del piloto. Los veredictos son propuestas: revísalos, completa las notas y decide en la sección final. Solo contiene totales, conteos y porcentajes.`,
    missing.length === 0
      ? "Se usaron todos los archivos de salida."
      : `Faltan ${missing.length} archivo(s); las filas afectadas dicen "sin datos" y el script que los genera:\n\n${mdTable(["Archivo", "Script"], missing.map((m) => [m.file, m.script]))}`,
  ].join("\n\n");

  const index = [
    "## Resumen de veredictos propuestos",
    mdTable(
      ["#", "Pregunta", "Veredicto propuesto"],
      findings.map((f) => [f.n, f.title, f.verdict]),
    ),
  ].join("\n\n");

  return `${[header, index, ...findings.map(renderFinding), goNoGo(findings)].join("\n\n")}\n`;
}
