import { eq } from "drizzle-orm";
import { getDb, type Database } from "@/server/db/client";
import { fieldData } from "@/server/db/schema";
import { CRUX_NAMES, FIELD_METRICS, parseRecord, type FieldMetrics } from "@/server/domain/field-data";
import { listProductionProjects } from "@/server/repositories/projects";
import { getSetting, setSetting } from "@/server/repositories/settings";
import { listMonitoredRoutes } from "@/server/repositories/history";
import { findProject } from "@/server/repositories/projects";
import type { Queue } from "bullmq";
import { maintenanceQueue } from "@/server/queue/queues";
import { CRUX_JOB } from "@/server/queue/schedulers";
import { assertUuid } from "./shared";

const ENDPOINT = "https://chromeuxreport.googleapis.com/v1/records:queryRecord";
/** El límite gratuito de la API es de 150 consultas por minuto: se deja margen. */
const PAUSE_MS = 500;
const MAX_ROUTES = 10;

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ status: number; ok: boolean; json(): Promise<unknown> }>;

export type CruxQuery = { apiKey: string; target: { url: string } | { origin: string }; formFactor: "mobile" | "desktop" };
export type CruxResult =
  | { status: "ok"; metrics: FieldMetrics; first: string | null; last: string | null }
  | { status: "no_data" };

export class CruxError extends Error {
  constructor(
    public readonly code: "BAD_KEY" | "QUOTA" | "UNAVAILABLE" | "INVALID",
    message: string,
  ) {
    super(message);
    this.name = "CruxError";
  }
}

/**
 * Consulta la API de CrUX para un sitio (origen) o una página (URL). La clave va en una cabecera, nunca en la
 * dirección, para que no quede en registros. Sin tráfico suficiente Google responde 404: es "sin datos", no un fallo.
 */
export async function fetchFieldData(query: CruxQuery, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<CruxResult> {
  let res;
  try {
    res = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": query.apiKey },
      body: JSON.stringify({ ...query.target, formFactor: query.formFactor === "mobile" ? "PHONE" : "DESKTOP", metrics: FIELD_METRICS.map((m) => CRUX_NAMES[m]) }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new CruxError("UNAVAILABLE", "No se pudo contactar con la API de Chrome UX Report.");
  }
  if (res.status === 404) return { status: "no_data" };
  if (res.status === 400) throw new CruxError("INVALID", "La API de Chrome UX Report rechazó la consulta.");
  if (res.status === 401 || res.status === 403) throw new CruxError("BAD_KEY", "La clave de la API de Chrome UX Report no es válida o no tiene permiso para esa API.");
  if (res.status === 429) throw new CruxError("QUOTA", "Se superó el límite de consultas de la API de Chrome UX Report.");
  if (!res.ok) throw new CruxError("UNAVAILABLE", `La API de Chrome UX Report respondió ${res.status}.`);
  const parsed = parseRecord(await res.json().catch(() => null));
  return parsed ? { status: "ok", ...parsed } : { status: "no_data" };
}

export type RefreshSummary = { checked: number; withData: number; noData: number };

/** Actualiza los datos reales de un proyecto: el sitio entero y hasta 10 páginas monitoreadas, en móvil y escritorio. */
export async function refreshProjectFieldData(
  projectId: string,
  deps: { db?: Database; apiKey: string; fetch?: FetchLike; sleep?: (ms: number) => Promise<void>; now?: () => Date },
): Promise<RefreshSummary> {
  const db = deps.db ?? getDb();
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = (deps.now ?? (() => new Date()))();
  const project = await findProject(db, projectId);
  if (!project) return { checked: 0, withData: 0, noData: 0 };
  const routes = (await listMonitoredRoutes(db, projectId)).slice(0, MAX_ROUTES);
  const routeUrls = new Map((await db.query.routes.findMany({ where: (r, { eq: e }) => e(r.projectId, projectId) })).map((r) => [r.id, r.url]));

  const targets: Array<{ target: string; routeId: string | null; query: { url: string } | { origin: string } }> = [
    { target: "origin", routeId: null, query: { origin: new URL(project.baseUrl).origin } },
    ...routes.flatMap((r) => (routeUrls.get(r.id) ? [{ target: r.id, routeId: r.id, query: { url: routeUrls.get(r.id)! } }] : [])),
  ];

  const summary: RefreshSummary = { checked: 0, withData: 0, noData: 0 };
  for (const t of targets) {
    for (const formFactor of ["mobile", "desktop"] as const) {
      const result = await fetchFieldData({ apiKey: deps.apiKey, target: t.query, formFactor }, deps.fetch);
      summary.checked++;
      if (result.status === "ok") summary.withData++;
      else summary.noData++;
      await db
        .insert(fieldData)
        .values({
          projectId,
          target: t.target,
          routeId: t.routeId,
          formFactor,
          status: result.status,
          metrics: result.status === "ok" ? result.metrics : null,
          collectionFirst: result.status === "ok" ? result.first : null,
          collectionLast: result.status === "ok" ? result.last : null,
          fetchedAt: now,
        })
        .onConflictDoUpdate({
          target: [fieldData.projectId, fieldData.target, fieldData.formFactor],
          set: {
            status: result.status,
            metrics: result.status === "ok" ? result.metrics : null,
            collectionFirst: result.status === "ok" ? result.first : null,
            collectionLast: result.status === "ok" ? result.last : null,
            fetchedAt: now,
          },
        });
      await sleep(PAUSE_MS);
    }
  }
  return summary;
}

export type CruxRunRecord = { at: string; ok: boolean; projects: number; checked: number; withData: number; error?: "NO_KEY" | "BAD_KEY" | "QUOTA" | "UNAVAILABLE" | "INVALID" };
const RUN_KEY = "crux_last_run";

/** Recorre los proyectos en producción y anota cómo salió, para que el panel lo explique. */
export async function refreshAllFieldData(deps: { db?: Database; apiKey: string | undefined; fetch?: FetchLike; sleep?: (ms: number) => Promise<void>; now?: () => Date }): Promise<CruxRunRecord> {
  const db = deps.db ?? getDb();
  const at = (deps.now ?? (() => new Date()))().toISOString();
  const record = async (r: Omit<CruxRunRecord, "at">) => {
    const full = { at, ...r };
    await setSetting(db, RUN_KEY, full);
    return full;
  };
  if (!deps.apiKey) return record({ ok: false, projects: 0, checked: 0, withData: 0, error: "NO_KEY" });
  const projects = await listProductionProjects(db);
  let checked = 0;
  let withData = 0;
  try {
    for (const p of projects) {
      const s = await refreshProjectFieldData(p.id, { db, apiKey: deps.apiKey, fetch: deps.fetch, sleep: deps.sleep, now: deps.now });
      checked += s.checked;
      withData += s.withData;
    }
  } catch (err) {
    const code = err instanceof CruxError ? err.code : "UNAVAILABLE";
    return record({ ok: false, projects: projects.length, checked, withData, error: code });
  }
  return record({ ok: true, projects: projects.length, checked, withData });
}

export async function getLastCruxRun(db: Database = getDb()): Promise<CruxRunRecord | null> {
  return (await getSetting<CruxRunRecord>(db, RUN_KEY)) ?? null;
}

export type FieldDataView = {
  target: string;
  formFactor: "mobile" | "desktop";
  status: "ok" | "no_data";
  metrics: FieldMetrics | null;
  first: string | null;
  last: string | null;
  fetchedAt: Date;
};

/** Datos reales guardados de un proyecto (sitio y páginas, ambos dispositivos). */
export async function listFieldData(projectId: string, db: Database = getDb()): Promise<FieldDataView[]> {
  assertUuid(projectId, "Proyecto");
  const rows = await db.select().from(fieldData).where(eq(fieldData.projectId, projectId));
  return rows.map((r) => ({
    target: r.target,
    formFactor: r.formFactor,
    status: r.status === "ok" ? "ok" : "no_data",
    metrics: (r.metrics as FieldMetrics | null) ?? null,
    first: r.collectionFirst,
    last: r.collectionLast,
    fetchedAt: r.fetchedAt,
  }));
}

export async function findFieldData(projectId: string, target: string, formFactor: "mobile" | "desktop", db: Database = getDb()): Promise<FieldDataView | null> {
  const all = await listFieldData(projectId, db);
  return all.find((r) => r.target === target && r.formFactor === formFactor) ?? null;
}

/** Pide al worker actualizar los datos reales ahora. Si ya hay una petición esperando, no encola otra. */
export async function requestFieldDataRefresh(deps: { queue?: Queue } = {}): Promise<{ queued: boolean }> {
  const queue = deps.queue ?? maintenanceQueue();
  const existing = await queue.getJob("crux-manual");
  if (existing) {
    const state = await existing.getState();
    if (state === "waiting" || state === "active" || state === "delayed" || state === "prioritized") return { queued: false };
    await existing.remove().catch(() => undefined);
  }
  await queue.add(CRUX_JOB, {}, { jobId: "crux-manual", removeOnComplete: true, removeOnFail: true });
  return { queued: true };
}
