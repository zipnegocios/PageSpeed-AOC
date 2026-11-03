import { showAsPassed } from "./agentic";

/**
 * Modelo de vista de un resultado de Lighthouse (`lhr`) ya traducido: lo que el informe de PageSpeed Insights
 * muestra, ordenado con las mismas reglas, pero como datos simples que la interfaz dibuja con sus propias piezas.
 * Es puro: no toca la red ni la base de datos.
 */
type Json = Record<string, unknown>;
type Locale = "es" | "en";

export type Lhr = Json;

const obj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

// ------------------------------------------------------------------ estado de una auditoría
export type AuditStatus = "pass" | "average" | "fail" | "informative" | "notApplicable" | "manual" | "error";

export function auditStatus(audit: Json): AuditStatus {
  const mode = str(audit.scoreDisplayMode);
  if (mode === "manual") return "manual";
  if (mode === "notApplicable") return "notApplicable";
  if (mode === "error") return "error";
  if (mode === "informative") return "informative";
  const score = num(audit.score);
  if (score === null) return "fail";
  return score >= 0.9 ? "pass" : score >= 0.5 ? "average" : "fail";
}

export type Rating = "pass" | "average" | "fail";
export const ratingOf = (score: number | null): Rating => (score === null ? "fail" : score >= 0.9 ? "pass" : score >= 0.5 ? "average" : "fail");

// ------------------------------------------------------------------ detalles
export type Cell =
  | { k: "text"; v: string }
  | { k: "url"; url: string; label: string }
  | { k: "link"; url: string; text: string }
  | { k: "code"; v: string }
  | { k: "node"; label: string; selector: string; snippet: string; lhId: string | null }
  | { k: "num"; v: string; unit: "bytes" | "ms" | "n" }
  | { k: "thumb"; src: string }
  | { k: "list"; cells: Cell[] };

export type Heading = { key: string; label: string; right: boolean };
export type Row = { cells: Record<string, Cell | null>; sub: Row[] };
export type TreeNode = { label: string; time: string; size: string; children: TreeNode[]; longest: boolean };

export type DetailsView =
  | { t: "table"; headings: Heading[]; rows: Row[]; hidden: number; subHeadings: Heading[] }
  | { t: "list"; items: DetailsView[] }
  | { t: "section"; title: string; description: string; value: DetailsView | null }
  | { t: "checklist"; items: Array<{ label: string; ok: boolean }> }
  | { t: "tree"; nodes: TreeNode[] }
  | { t: "node"; cell: Extract<Cell, { k: "node" }> }
  | { t: "text"; v: string };

export const MAX_ROWS = 50;
const MAX_TREE = 40;

function formatters(locale: Locale) {
  const nf = (max: number) => new Intl.NumberFormat(locale === "es" ? "es" : "en", { maximumFractionDigits: max });
  return {
    bytes: (n: number) => (n >= 1024 * 1024 ? `${nf(1).format(n / 1024 / 1024)} MiB` : `${nf(1).format(n / 1024)} KiB`),
    ms: (n: number) => (n >= 1000 ? `${nf(1).format(n / 1000)} s` : `${nf(0).format(n)} ms`),
    n: (n: number, granularity?: number | null) => nf(granularity && granularity < 1 ? 3 : 0).format(n),
  };
}

function nodeCell(v: Json): Extract<Cell, { k: "node" }> {
  return {
    k: "node",
    label: str(v.nodeLabel) || str(v.selector),
    selector: str(v.selector),
    snippet: str(v.snippet),
    lhId: str(v.lhId) || null,
  };
}

function cellOf(value: unknown, valueType: string, locale: Locale): Cell | null {
  const f = formatters(locale);
  if (value === null || value === undefined || value === "") return null;
  const o = obj(value);
  const type = o ? str(o.type) : "";

  if (type === "node") return nodeCell(o!);
  if (type === "link") return { k: "link", url: str(o!.url), text: str(o!.text) || str(o!.url) };
  if (type === "url") return { k: "url", url: str(o!.value), label: str(o!.value) };
  if (type === "code") return { k: "code", v: str(o!.value) };
  if (type === "text") return { k: "text", v: str(o!.value) };
  if (type === "numeric") return { k: "num", v: f.n(num(o!.value) ?? 0, num(o!.granularity)), unit: "n" };
  if (type === "source-location") {
    const line = num(o!.line);
    return { k: "code", v: `${str(o!.url)}${line !== null && line >= 0 ? `:${line + 1}` : ""}` };
  }
  if (type === "thumbnail") return str(o!.url).startsWith("data:image/") ? { k: "thumb", src: str(o!.url) } : null;
  if (!o && Array.isArray(value)) return { k: "list", cells: value.map((x) => cellOf(x, valueType, locale)).filter((c): c is Cell => c !== null) };
  if (o) return { k: "code", v: JSON.stringify(o).slice(0, 160) };

  switch (valueType) {
    case "bytes":
      return typeof value === "number" ? { k: "num", v: f.bytes(value), unit: "bytes" } : { k: "text", v: str(value) };
    case "ms":
    case "timespanMs":
      return typeof value === "number" ? { k: "num", v: f.ms(value), unit: "ms" } : { k: "text", v: str(value) };
    case "numeric":
      return typeof value === "number" ? { k: "num", v: f.n(value), unit: "n" } : { k: "text", v: str(value) };
    case "url":
      return { k: "url", url: str(value), label: str(value) };
    case "code":
      return { k: "code", v: str(value) };
    case "link":
      return { k: "link", url: str(value), text: str(value) };
    default:
      return { k: "text", v: str(value) };
  }
}

function headingsOf(raw: unknown): Array<{ key: string; valueType: string; label: string; sub: { key: string; valueType: string } | null }> {
  return arr(raw).flatMap((h) => {
    const o = obj(h);
    if (!o) return [];
    const key = str(o.key) || str(o.valueType);
    const sub = obj(o.subItemsHeading);
    return [{ key, valueType: str(o.valueType) || "text", label: str(o.label) || (obj(o.label) ? "" : ""), sub: sub ? { key: str(sub.key) || key, valueType: str(sub.valueType) || "text" } : null }];
  });
}

function rowOf(item: Json, heads: ReturnType<typeof headingsOf>, locale: Locale): Row {
  const cells: Record<string, Cell | null> = {};
  for (const h of heads) cells[h.key] = cellOf(item[h.key], h.valueType, locale);
  const subs = arr(obj(item.subItems)?.items)
    .map(obj)
    .filter((x): x is Json => x !== null)
    .map((s) => {
      const subCells: Record<string, Cell | null> = {};
      for (const h of heads) if (h.sub) subCells[h.key] = cellOf(s[h.sub.key] ?? s[h.key], h.sub.valueType, locale);
      return { cells: subCells, sub: [] } satisfies Row;
    });
  return { cells, sub: subs };
}

function treeOf(chains: unknown, locale: Locale): TreeNode[] {
  const f = formatters(locale);
  const walk = (value: unknown, budget: { left: number }): TreeNode[] =>
    Object.values(obj(value) ?? {}).flatMap((c) => {
      const o = obj(c);
      if (!o || budget.left <= 0) return [];
      budget.left--;
      return [
        {
          label: str(o.url),
          time: num(o.navStartToEndTime) !== null ? f.ms(num(o.navStartToEndTime)!) : "",
          size: num(o.transferSize) !== null ? f.bytes(num(o.transferSize)!) : "",
          longest: o.isLongest === true,
          children: walk(o.children, budget),
        },
      ];
    });
  return walk(chains, { left: MAX_TREE });
}

/** Convierte el `details` de una auditoría a algo que se pueda dibujar. null si no hay nada que mostrar. */
export function detailsView(details: unknown, locale: Locale): DetailsView | null {
  const d = obj(details);
  if (!d) return null;
  const type = str(d.type);

  if (type === "table" || type === "opportunity") {
    const heads = headingsOf(d.headings);
    const items = arr(d.items).map(obj).filter((x): x is Json => x !== null);
    if (heads.length === 0) return null;
    return {
      t: "table",
      headings: heads.map((h) => ({ key: h.key, label: h.label, right: ["bytes", "ms", "timespanMs", "numeric"].includes(h.valueType) })),
      rows: items.slice(0, MAX_ROWS).map((i) => rowOf(i, heads, locale)),
      hidden: Math.max(0, items.length - MAX_ROWS),
      subHeadings: [],
    };
  }
  if (type === "list") {
    const items = arr(d.items).map((i) => detailsView(i, locale)).filter((v): v is DetailsView => v !== null);
    return items.length ? { t: "list", items } : null;
  }
  if (type === "list-section") {
    const value = detailsView(d.value, locale);
    return { t: "section", title: str(d.title), description: str(d.description), value };
  }
  if (type === "checklist") {
    const items = Object.values(obj(d.items) ?? {}).flatMap((x) => {
      const o = obj(x);
      return o ? [{ label: str(o.label), ok: o.value === true }] : [];
    });
    return items.length ? { t: "checklist", items } : null;
  }
  if (type === "network-tree" || type === "criticalrequestchain") {
    const nodes = treeOf(d.chains, locale);
    return nodes.length ? { t: "tree", nodes } : null;
  }
  if (type === "node") return { t: "node", cell: nodeCell(d) };
  if (type === "text") return str(d.value) ? { t: "text", v: str(d.value) } : null;
  // screenshot, filmstrip, debugdata, treemap-data y desconocidos: tienen su propia vista o no se muestran.
  return null;
}

// ------------------------------------------------------------------ auditorías y categorías
export type AuditView = {
  id: string;
  title: string;
  description: string;
  displayValue: string;
  status: AuditStatus;
  group: string | null;
  weight: number;
  /** Ahorro estimado de tiempo (ms) y de tamaño (bytes) que declara la auditoría. */
  savingsMs: number | null;
  savingsBytes: number | null;
  metricSavings: Record<string, number>;
  details: DetailsView | null;
  /** Consejos específicos de la tecnología del sitio (WordPress, Next, etc.). */
  tips: Array<{ pack: string; text: string }>;
};

export type MetricView = { id: string; acronym: string; title: string; displayValue: string; rating: Rating; description: string };
export type SectionView = { id: string; title: string; description: string; audits: AuditView[] };
export type CategoryView = {
  id: string;
  title: string;
  description: string;
  /** 0-100, o null si es una categoría de fracción o no se calculó. */
  score: number | null;
  fraction: { passed: number; total: number } | null;
  metrics: MetricView[];
  sections: SectionView[];
  passed: AuditView[];
  notApplicable: AuditView[];
  manual: AuditView[];
};

export const METRIC_FILTERS = ["FCP", "LCP", "TBT", "CLS"] as const;

function stackTips(lhr: Lhr, auditId: string): AuditView["tips"] {
  return arr(lhr.stackPacks).flatMap((p) => {
    const o = obj(p);
    const text = str(obj(o?.descriptions)?.[auditId]);
    return o && text ? [{ pack: str(o.title), text }] : [];
  });
}

function auditView(lhr: Lhr, ref: Json, locale: Locale): AuditView | null {
  const audit = obj(obj(lhr.audits)?.[str(ref.id)]);
  if (!audit) return null;
  const details = obj(audit.details);
  const savings = obj(audit.metricSavings) ?? {};
  return {
    id: str(ref.id),
    title: str(audit.title),
    description: str(audit.description),
    displayValue: str(audit.displayValue),
    status: auditStatus(audit),
    group: str(ref.group) || null,
    weight: num(ref.weight) ?? 0,
    savingsMs: num(details?.overallSavingsMs),
    savingsBytes: num(details?.overallSavingsBytes),
    metricSavings: Object.fromEntries(Object.entries(savings).filter(([, v]) => typeof v === "number")) as Record<string, number>,
    details: detailsView(details, locale),
    tips: stackTips(lhr, str(ref.id)),
  };
}

const RANK: Record<AuditStatus, number> = { fail: 0, average: 1, error: 2, informative: 3, pass: 4, manual: 5, notApplicable: 6 };

function sortAudits(list: AuditView[], metric: string | null): AuditView[] {
  const impact = (a: AuditView) => (metric ? (a.metricSavings[metric] ?? -1) : (a.savingsMs ?? 0) + (a.savingsBytes ?? 0) / 1024);
  return [...list].sort((a, b) => RANK[a.status] - RANK[b.status] || impact(b) - impact(a) || b.weight - a.weight);
}

/** Vista de una categoría con las mismas reglas de agrupación y orden que el informe de Lighthouse. */
export function buildCategoryView(lhr: Lhr, categoryId: string, options: { locale: Locale; metric?: string | null }): CategoryView | null {
  const category = obj(obj(lhr.categories)?.[categoryId]);
  if (!category) return null;
  const groups = obj(lhr.categoryGroups) ?? {};
  const refs = arr(category.auditRefs).map(obj).filter((r): r is Json => r !== null);
  const metric = options.metric && (METRIC_FILTERS as readonly string[]).includes(options.metric) ? options.metric : null;

  const metrics: MetricView[] = refs
    .filter((r) => str(r.group) === "metrics")
    .flatMap((r) => {
      const a = obj(obj(lhr.audits)?.[str(r.id)]);
      return a ? [{ id: str(r.id), acronym: str(r.acronym), title: str(a.title), displayValue: str(a.displayValue), rating: ratingOf(num(a.score)), description: str(a.description) }] : [];
    });

  const all = refs.filter((r) => str(r.group) !== "metrics" && str(r.group) !== "hidden").flatMap((r) => {
    const v = auditView(lhr, r, options.locale);
    return v ? [v] : [];
  });

  const passed: AuditView[] = [];
  const notApplicable: AuditView[] = [];
  const manual: AuditView[] = [];
  const shown: AuditView[] = [];
  for (const a of all) {
    if (a.status === "notApplicable") notApplicable.push(a);
    else if (a.status === "manual") manual.push(a);
    else if (a.status === "pass") passed.push(a);
    else shown.push(a);
  }

  const order: string[] = [];
  for (const a of shown) if (!order.includes(a.group ?? "")) order.push(a.group ?? "");
  const sections: SectionView[] = order.map((id) => {
    const g = obj(groups[id]);
    let list = shown.filter((a) => (a.group ?? "") === id);
    if (categoryId === "performance" && metric) list = list.filter((a) => a.metricSavings[metric] !== undefined);
    return { id: id || "otros", title: str(g?.title), description: str(g?.description), audits: sortAudits(list, metric) };
  });

  const score = num(category.score);
  return {
    id: categoryId,
    title: str(category.title),
    description: str(category.description),
    score: category.categoryScoreDisplayMode === "fraction" || score === null ? null : Math.round(score * 100),
    fraction: category.categoryScoreDisplayMode === "fraction" ? fractionOf(lhr, categoryId) : null,
    metrics,
    sections: sections.filter((s) => s.audits.length > 0),
    passed: sortAudits(passed, null),
    notApplicable,
    manual,
  };
}

function fractionOf(lhr: Lhr, categoryId: string): { passed: number; total: number } | null {
  const refs = arr(obj(obj(lhr.categories)?.[categoryId])?.auditRefs).map(obj).filter((r): r is Json => r !== null);
  let passed = 0;
  let total = 0;
  for (const r of refs) {
    const a = obj(obj(lhr.audits)?.[str(r.id)]);
    if (!a || str(r.group) === "hidden") continue;
    const mode = str(a.scoreDisplayMode);
    if (mode === "manual" || mode === "notApplicable" || mode === "informative") continue;
    total++;
    if (showAsPassed({ scoreDisplayMode: mode, score: num(a.score) })) passed++;
  }
  return total === 0 ? null : { passed, total };
}

// ------------------------------------------------------------------ resumen y entorno
export type SummaryView = {
  url: string;
  fetchedAt: string | null;
  categories: Array<{ id: string; title: string; score: number | null; fraction: { passed: number; total: number } | null }>;
  warnings: string[];
  environment: Array<{ label: string; value: string }>;
  finalScreenshot: string | null;
  filmstrip: Array<{ timing: number; data: string }>;
};

const CATEGORY_ORDER = ["performance", "accessibility", "best-practices", "seo", "agentic-browsing"] as const;
export const CATEGORY_IDS = CATEGORY_ORDER;

function deviceName(lhr: Lhr): string {
  const settings = obj(lhr.configSettings) ?? {};
  const ua = str(obj(lhr.environment)?.networkUserAgent);
  const model = /;\s*([^;)]+?)\)\s*AppleWebKit/.exec(ua)?.[1]?.trim();
  if (str(settings.formFactor) === "desktop") return "Escritorio emulado";
  return model && !/^X11|Linux$/i.test(model) ? `Móvil emulado (${model})` : "Móvil emulado";
}

function networkLabel(lhr: Lhr): string {
  const t = obj(obj(lhr.configSettings)?.throttling);
  if (!t) return "Sin limitación de red";
  const rtt = num(t.rttMs);
  const kbps = num(t.throughputKbps);
  const cpu = num(t.cpuSlowdownMultiplier);
  if (rtt === 150 && kbps !== null && Math.abs(kbps - 1638.4) < 1) return `Limitación de red 4G lenta simulada${cpu ? ` · CPU ×${cpu}` : ""}`;
  if (rtt === 40 && kbps === 10240) return `Limitación de banda ancha simulada${cpu ? ` · CPU ×${cpu}` : ""}`;
  return `Red simulada: ${rtt ?? "?"} ms de latencia, ${kbps !== null ? (kbps / 1024).toFixed(1) : "?"} Mbps${cpu ? ` · CPU ×${cpu}` : ""}`;
}

export function buildSummary(lhr: Lhr, locale: Locale): SummaryView {
  const cats = obj(lhr.categories) ?? {};
  const audits = obj(lhr.audits) ?? {};
  const fetched = str(lhr.fetchTime);
  const date = fetched ? new Date(fetched) : null;
  const chrome = /(Headless)?Chrome\/([\d.]+)/.exec(str(obj(lhr.environment)?.hostUserAgent));
  const filmstripItems = arr(obj(obj(audits["screenshot-thumbnails"])?.details)?.items);
  const finalData = str(obj(obj(audits["final-screenshot"])?.details)?.data);
  return {
    url: str(lhr.finalDisplayedUrl) || str(lhr.finalUrl) || str(lhr.requestedUrl),
    fetchedAt: date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat(locale === "es" ? "es" : "en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date) + " UTC" : null,
    categories: CATEGORY_ORDER.filter((id) => cats[id]).map((id) => {
      const c = obj(cats[id])!;
      const isFraction = c.categoryScoreDisplayMode === "fraction";
      const score = num(c.score);
      return { id, title: str(c.title), score: isFraction || score === null ? null : Math.round(score * 100), fraction: isFraction ? fractionOf(lhr, id) : null };
    }),
    warnings: arr(lhr.runWarnings).map(str).filter(Boolean),
    environment: [
      { label: "Dispositivo", value: deviceName(lhr) },
      { label: "Red", value: networkLabel(lhr) },
      { label: "Tipo de carga", value: str(lhr.gatherMode) === "navigation" ? "Carga inicial de la página" : str(lhr.gatherMode) || "—" },
      { label: "Navegador", value: chrome ? `${chrome[1] ?? ""}Chrome ${chrome[2]}` : "—" },
      { label: "Lighthouse", value: str(lhr.lighthouseVersion) || "—" },
    ],
    finalScreenshot: finalData.startsWith("data:image/") ? finalData : null,
    filmstrip: filmstripItems.flatMap((i) => {
      const o = obj(i);
      const data = str(o?.data);
      return o && data.startsWith("data:image/") ? [{ timing: num(o.timing) ?? 0, data }] : [];
    }),
  };
}

// ------------------------------------------------------------------ evidencias (elementos sobre la captura)
export type EvidenceNode = { n: number; lhId: string; label: string; selector: string; rect: { top: number; left: number; width: number; height: number } };
export type EvidenceAudit = { id: string; title: string; status: AuditStatus; nodes: EvidenceNode[] };
export type EvidenceView = { width: number; height: number; audits: EvidenceAudit[] } | null;

function collectNodes(value: unknown, out: Json[], depth = 0): void {
  if (depth > 8 || out.length > 200) return;
  if (Array.isArray(value)) return void value.forEach((v) => collectNodes(v, out, depth + 1));
  const o = obj(value);
  if (!o) return;
  if (o.type === "node" && typeof o.lhId === "string") out.push(o);
  for (const v of Object.values(o)) if (v && typeof v === "object") collectNodes(v, out, depth + 1);
}

/** Elementos de cada auditoría que no se cumple, situados sobre la captura de página completa. null si no hay captura. */
export function buildEvidence(lhr: Lhr): EvidenceView {
  const full = obj(lhr.fullPageScreenshot);
  const shot = obj(full?.screenshot);
  const rects = obj(full?.nodes);
  const width = num(shot?.width);
  const height = num(shot?.height);
  if (!shot || !rects || !width || !height || !str(shot.data).startsWith("data:image/")) return null;

  const audits: EvidenceAudit[] = [];
  for (const [id, raw] of Object.entries(obj(lhr.audits) ?? {})) {
    const audit = obj(raw);
    if (!audit) continue;
    const status = auditStatus(audit);
    if (status !== "fail" && status !== "average" && status !== "informative") continue;
    const found: Json[] = [];
    collectNodes(audit.details, found);
    const seen = new Set<string>();
    const nodes: EvidenceNode[] = [];
    for (const n of found) {
      const lhId = str(n.lhId);
      const r = obj(rects[lhId]);
      if (!r || seen.has(lhId)) continue;
      const w = num(r.width) ?? 0;
      const h = num(r.height) ?? 0;
      if (w <= 0 || h <= 0) continue;
      seen.add(lhId);
      nodes.push({ n: nodes.length + 1, lhId, label: str(n.nodeLabel) || str(n.selector), selector: str(n.selector), rect: { top: num(r.top) ?? 0, left: num(r.left) ?? 0, width: w, height: h } });
    }
    if (nodes.length > 0 && status !== "informative") audits.push({ id, title: str(audit.title), status, nodes });
  }
  audits.sort((a, b) => RANK[a.status] - RANK[b.status] || b.nodes.length - a.nodes.length);
  return { width, height, audits };
}

/** Bytes de la captura de página completa, para servirla como imagen. */
export function fullPageImage(lhr: Lhr): { mime: string; bytes: Buffer } | null {
  return imageFromDataUri(str(obj(obj(lhr.fullPageScreenshot)?.screenshot)?.data));
}

export function finalImage(lhr: Lhr): { mime: string; bytes: Buffer } | null {
  return imageFromDataUri(str(obj(obj(obj(lhr.audits)?.["final-screenshot"])?.details)?.data));
}

function imageFromDataUri(uri: string): { mime: string; bytes: Buffer } | null {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(uri);
  return m ? { mime: m[1]!, bytes: Buffer.from(m[2]!, "base64") } : null;
}

// ------------------------------------------------------------------ mapa de scripts
export type ScriptItem = { name: string; bytes: number; unused: number };

/** Scripts de la página por tamaño (primer nivel del `script-treemap-data`), de mayor a menor. */
export function scriptItems(lhr: Lhr, limit = 40): ScriptItem[] {
  const nodes = arr(obj(obj(obj(lhr.audits)?.["script-treemap-data"])?.details)?.nodes);
  return nodes
    .flatMap((n) => {
      const o = obj(n);
      const bytes = num(o?.resourceBytes);
      return o && bytes !== null && bytes > 0 ? [{ name: str(o.name), bytes, unused: Math.min(bytes, num(o.unusedBytes) ?? 0) }] : [];
    })
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, limit);
}
