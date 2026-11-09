import type { Queue } from "bullmq";
import type { Redis } from "ioredis";
import { getDb, type Database } from "@/server/db/client";
import { DomainError } from "@/server/domain/errors";
import { toPageRows } from "@/server/domain/seo-crawl-rows";
import { byLanguage, diffIssues, evaluate, ISSUE_CATALOG, ISSUE_CODES, summarize, type IssueCode, type Severity, type SeverityCounts } from "@/server/domain/seo-crawl-rules";
import { parseLangParam } from "@/server/domain/seo-markets";
import { getRedis } from "@/server/queue/connection";
import { readHeartbeat } from "@/server/queue/heartbeat";
import { seoQueue } from "@/server/queue/queues";
import { crawlJobId, SEO_CRAWL_JOB } from "@/server/queue/schedulers";
import { findProject } from "@/server/repositories/projects";
import { listRoutes } from "@/server/repositories/routes";
import * as repo from "@/server/repositories/seo-crawl";
import { listMarkets } from "@/server/repositories/seo-markets";
import { crawl, DEFAULT_LIMITS, type CrawlOptions, type CrawlOutcome } from "@/server/seo/crawler";
import { getMarkets, type SeoMarket } from "./seo-markets";
import { assertUuid, isUniqueViolation } from "./shared";

const ENQUEUE_TIMEOUT_MS = 8_000;
/** Cuántos rastreos terminados conservan sus páginas y hallazgos por proyecto. */
export const KEEP_RUNS = 12;
/** Un rastreo en cola sin trabajo en Redis desde hace más de esto se da por perdido. */
const STALE_QUEUED_MS = 5 * 60_000;
/** Un rastreo en curso desde hace más que esto (el plazo del rastreador es 20 minutos) y sin trabajo activo se da por perdido. */
const STALE_RUNNING_MS = 45 * 60_000;

/** Lo que se puede sustituir al rastrear: solo pruebas y desarrollo. */
export type CrawlDeps = Pick<CrawlOptions, "fetchHop" | "sleep" | "now" | "allowPrivate">;

export type CrawlRequest = { queued: boolean; /** El rastreo pedido o, si ya había uno activo, ese. */ runId: string | null };

/** Crea el rastreo y su trabajo. Si el proyecto ya tiene uno en cola o en curso, devuelve ese y no encola otro. */
async function enqueueRun(db: Database, queue: Queue, projectId: string, trigger: "manual" | "scheduled"): Promise<CrawlRequest> {
  let runId: string;
  try {
    runId = (await repo.createRun(db, projectId, trigger)).id;
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return { queued: false, runId: (await repo.findActiveRun(db, projectId))?.id ?? null };
  }
  // Con Redis caído las órdenes de BullMQ se quedan esperando para siempre: mejor fallar que dejar el botón colgado.
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ENQUEUE_TIMEOUT_MS);
  });
  try {
    await Promise.race([
      queue.add(SEO_CRAWL_JOB, { runId }, { jobId: crawlJobId(runId), attempts: 1, removeOnComplete: { age: 7 * 24 * 3600 }, removeOnFail: { age: 30 * 24 * 3600 } }),
      deadline,
    ]);
  } catch {
    // Sin trabajo, el rastreo en cola bloquearía al proyecto: se cierra como fallido y se avisa.
    await repo.failRun(db, runId, "No se pudo encolar el rastreo (Redis no responde).", "enqueue");
    throw new DomainError("UPSTREAM", "No se pudo pedir el rastreo (Redis no responde). Inténtalo de nuevo.");
  } finally {
    clearTimeout(timer);
  }
  return { queued: true, runId };
}

/**
 * Pide al worker rastrear un proyecto ahora. Sirve para cualquier proyecto, también los de desarrollo. Si ya hay un
 * rastreo en cola o en curso, no encola otro. Exige un worker en línea.
 */
export async function requestCrawl(projectId: string, deps: { db?: Database; queue?: Queue; redis?: Redis } = {}): Promise<CrawlRequest> {
  assertUuid(projectId, "Proyecto");
  const db = deps.db ?? getDb();
  if (!(await findProject(db, projectId))) throw new DomainError("NOT_FOUND", "Proyecto no encontrado.");
  const redis = deps.redis ?? getRedis();
  if (!(await readHeartbeat(redis))) throw new DomainError("UPSTREAM", "El worker no está en línea. Inicia el servicio worker e inténtalo de nuevo.");
  return enqueueRun(db, deps.queue ?? seoQueue(redis), projectId, "manual");
}

export type WeeklyCrawlSummary = { projects: number; queued: number; skipped: number; failed: number };

/** Ronda semanal: encola un rastreo por cada proyecto en producción con conexión SEO que no tenga uno activo. */
export async function scheduleWeeklyCrawls(deps: { db?: Database; queue: Queue }): Promise<WeeklyCrawlSummary> {
  const db = deps.db ?? getDb();
  const ids = await repo.listCrawlProjectIds(db);
  const summary: WeeklyCrawlSummary = { projects: ids.length, queued: 0, skipped: 0, failed: 0 };
  for (const id of ids) {
    try {
      const r = await enqueueRun(db, deps.queue, id, "scheduled");
      if (r.queued) summary.queued += 1;
      else summary.skipped += 1;
    } catch (err) {
      // Un proyecto con un fallo no detiene al resto de la ronda.
      console.error("[seo] ronda semanal de rastreo", err instanceof Error ? err.name : "error");
      summary.failed += 1;
    }
  }
  return summary;
}

// ------------------------------------------------------------------ ejecución

export type RunSummary = {
  runId: string;
  /** `skipped`: el rastreo ya no estaba en cola (lo tomó otro trabajo o se canceló). */
  status: "succeeded" | "partial" | "failed" | "skipped";
  outcome: CrawlOutcome | "error" | null;
  pages: number;
  issues: SeverityCounts | null;
  detail: string | null;
};

const STATUS_OF: Record<CrawlOutcome, "succeeded" | "partial" | "failed"> = {
  complete: "succeeded",
  partial: "partial",
  site_blocked: "failed",
  blocked_by_site: "failed",
  login_required: "failed",
  unreachable: "failed",
};

/** Hechos del proyecto que necesita el rastreador. La dirección y los hosts permitidos salen del proyecto, nunca de la petición. */
async function crawlTarget(db: Database, projectId: string) {
  const project = await findProject(db, projectId);
  if (!project) return null;
  const allowedHosts = project.allowedHosts.length > 0 ? project.allowedHosts : [new URL(project.baseUrl).hostname];
  const seedPaths = (await listRoutes(db, projectId)).filter((r) => !r.requiresAuth).map((r) => r.path);
  return { baseUrl: project.baseUrl, sitemapUrl: project.sitemapUrl, allowedHosts, seedPaths };
}

/**
 * Ejecuta un rastreo ya creado: lo toma, rastrea, evalúa las reglas y guarda páginas y hallazgos en una transacción. Lo que
 * salga mal queda en el propio rastreo como fallido, con un mensaje legible; no lanza errores al worker (un reintento
 * del mismo rastreo no tiene sentido).
 */
export async function runCrawl(runId: string, db: Database = getDb(), deps: CrawlDeps = {}): Promise<RunSummary> {
  assertUuid(runId, "Rastreo");
  const run = await repo.getRun(db, runId);
  const skipped: RunSummary = { runId, status: "skipped", outcome: null, pages: 0, issues: null, detail: null };
  if (!run || run.status !== "queued") return skipped;
  if (!(await repo.markRunning(db, runId, { ...DEFAULT_LIMITS }))) return skipped;

  const failed = async (detail: string, outcome: "error" = "error"): Promise<RunSummary> => {
    await repo.failRun(db, runId, detail, outcome);
    return { runId, status: "failed", outcome, pages: 0, issues: null, detail };
  };

  try {
    const target = await crawlTarget(db, run.projectId);
    if (!target) return await failed("El proyecto ya no existe o está archivado.");
    const markets = await listMarkets(db, run.projectId);
    const result = await crawl({ ...target, ...deps });
    const status = STATUS_OF[result.outcome];

    const keep = status !== "failed";
    const issues = keep ? evaluate({ pages: result.pages, site: result.site, markets }) : [];
    const pages = keep ? toPageRows(result.pages, result.site, markets) : [];
    const closed = await repo.finishRun(
      db,
      runId,
      { status, outcome: result.outcome, detail: result.detail, pagesCrawled: result.pages.length, pagesDiscovered: result.discovered, requests: result.requests, truncatedBy: result.truncatedBy },
      pages,
      issues,
    );
    // Si la reconciliación lo cerró mientras tanto, no se pisa y no se poda.
    if (!closed) return { ...skipped, detail: "El rastreo ya estaba cerrado." };
    await repo.pruneRuns(db, run.projectId, KEEP_RUNS);
    return { runId, status, outcome: result.outcome, pages: result.pages.length, issues: keep ? summarize(issues) : null, detail: result.detail };
  } catch (err) {
    console.error("[seo] rastreo", err instanceof Error ? err.name : "error");
    return failed("El rastreo falló por un error inesperado. Inténtalo de nuevo; si se repite, revisa los registros del worker.");
  }
}

// ------------------------------------------------------------------ reconciliación

const ALIVE = new Set(["waiting", "prioritized", "delayed", "waiting-children", "active"]);

/**
 * Postgres es la fuente de verdad y Redis es transitorio: un rastreo en cola cuyo trabajo ya no existe, o en curso desde hace
 * demasiado sin trabajo activo, se marca fallido para no bloquear al proyecto. Es idempotente.
 */
export async function reconcileCrawlRuns(deps: { db?: Database; queue: Queue; now?: Date }): Promise<{ failed: number }> {
  const db = deps.db ?? getDb();
  const now = (deps.now ?? new Date()).getTime();
  let failed = 0;
  for (const run of await repo.listOpenRuns(db)) {
    const since = run.status === "running" ? (run.startedAt ?? run.queuedAt).getTime() : run.queuedAt.getTime();
    if (now - since < (run.status === "running" ? STALE_RUNNING_MS : STALE_QUEUED_MS)) continue;
    const job = await deps.queue.getJob(crawlJobId(run.id));
    const state = job ? await job.getState() : "unknown";
    // Un trabajo activo sigue vivo (BullMQ renueva su bloqueo); uno en espera aún llegará a ejecutarse.
    if (run.status === "running" ? state === "active" : ALIVE.has(state)) continue;
    if (await repo.failRun(db, run.id, "El rastreo se perdió (el worker se detuvo o Redis perdió el trabajo). Vuelve a pedirlo.", "stale")) failed += 1;
  }
  return { failed };
}

// ------------------------------------------------------------------ lectura

export type CrawlRunView = Pick<
  repo.RunRow,
  "id" | "status" | "trigger" | "queuedAt" | "startedAt" | "finishedAt" | "outcome" | "detail" | "pagesCrawled" | "pagesDiscovered" | "truncatedBy" | "errors" | "warnings" | "infos"
>;

export type CrawlGroup = { code: IssueCode; severity: Severity; group: (typeof ISSUE_CATALOG)[IssueCode]["group"]; title: string; advice: string; pages: number; added: number };

export type CrawlDetail = {
  code: IssueCode;
  severity: Severity;
  title: string;
  advice: string;
  rows: Array<{ page: string; lang: string | null; evidence: Record<string, string | number | boolean | string[]>; isNew: boolean }>;
  /** Filas que no caben en pantalla. */
  more: number;
};

export type CrawlReport = {
  /** Rastreo en cola o en curso. */
  active: CrawlRunView | null;
  /** El último pedido, de cualquier estado: dice si el más reciente falló. */
  latest: CrawlRunView | null;
  /** El último terminado con datos: de él salen los números. */
  current: CrawlRunView | null;
  previous: CrawlRunView | null;
  markets: SeoMarket[];
  /** Idioma aplicado (`?idioma=`) o null si se ven todos. */
  lang: string | null;
  counts: SeverityCounts | null;
  previousCounts: SeverityCounts | null;
  /** Hallazgos nuevos y resueltos frente al rastreo anterior; null si no hay anterior. */
  changes: { added: number; resolved: number } | null;
  groups: CrawlGroup[];
  detail: CrawlDetail | null;
  /** Conteos de los últimos rastreos terminados, del más antiguo al más reciente. */
  history: Array<{ at: Date; errors: number; warnings: number; infos: number }>;
};

const MAX_DETAIL_ROWS = 200;

const view = (r: repo.RunRow): CrawlRunView => ({
  id: r.id, status: r.status, trigger: r.trigger, queuedAt: r.queuedAt, startedAt: r.startedAt, finishedAt: r.finishedAt, outcome: r.outcome, detail: r.detail,
  pagesCrawled: r.pagesCrawled, pagesDiscovered: r.pagesDiscovered, truncatedBy: r.truncatedBy, errors: r.errors, warnings: r.warnings, infos: r.infos,
});

/**
 * Lo que muestra la pantalla «Auditoría técnica»: el estado del último rastreo, los números del último terminado con su
 * variación frente al anterior, los hallazgos agrupados por tipo y, si se pide uno (`code`), sus páginas con la evidencia.
 */
export async function getCrawlReport(projectId: string, opts: { lang?: string; code?: string } = {}, db: Database = getDb()): Promise<CrawlReport> {
  assertUuid(projectId, "Proyecto");
  const [recent, finished, markets] = await Promise.all([repo.listRuns(db, projectId, 1), repo.listFinishedRuns(db, projectId, 12), getMarkets(projectId, db)]);
  const active = await repo.findActiveRun(db, projectId);
  const [current, previous] = finished;
  const lang = parseLangParam(opts.lang, markets) ?? null;
  const history = [...finished].reverse().map((r) => ({ at: r.queuedAt, errors: r.errors, warnings: r.warnings, infos: r.infos }));
  const base = { active: active ? view(active) : null, latest: recent[0] ? view(recent[0]) : null, current: current ? view(current) : null, previous: previous ? view(previous) : null, markets, lang, history };
  if (!current) return { ...base, counts: null, previousCounts: null, changes: null, groups: [], detail: null };

  const now = byLanguage(await repo.listIssues(db, current.id), lang);
  const before = previous ? byLanguage(await repo.listIssues(db, previous.id), lang) : null;
  const diff = before ? diffIssues(before, now) : null;
  const added = new Set(diff?.added.map((i) => `${i.code}|${i.page}`) ?? []);

  const groups = new Map<IssueCode, CrawlGroup>();
  for (const i of now) {
    const code = i.code as IssueCode;
    const g = groups.get(code) ?? { code, severity: ISSUE_CATALOG[code].severity, group: ISSUE_CATALOG[code].group, title: ISSUE_CATALOG[code].title, advice: ISSUE_CATALOG[code].advice, pages: 0, added: 0 };
    g.pages += 1;
    if (added.has(`${i.code}|${i.page}`)) g.added += 1;
    groups.set(code, g);
  }
  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  const sorted = [...groups.values()].sort((a, b) => order[a.severity] - order[b.severity] || b.pages - a.pages || a.code.localeCompare(b.code));

  let detail: CrawlDetail | null = null;
  const code = ISSUE_CODES.find((c) => c === opts.code);
  if (code && groups.has(code)) {
    const rows = now.filter((i) => i.code === code);
    detail = {
      code,
      severity: ISSUE_CATALOG[code].severity,
      title: ISSUE_CATALOG[code].title,
      advice: ISSUE_CATALOG[code].advice,
      rows: rows.slice(0, MAX_DETAIL_ROWS).map((i) => ({ page: i.page, lang: i.lang, evidence: i.evidence, isNew: added.has(`${i.code}|${i.page}`) })),
      more: Math.max(0, rows.length - MAX_DETAIL_ROWS),
    };
  }
  return {
    ...base,
    counts: summarize(now),
    previousCounts: before ? summarize(before) : null,
    changes: diff ? { added: diff.added.length, resolved: diff.resolved.length } : null,
    groups: sorted,
    detail,
  };
}
