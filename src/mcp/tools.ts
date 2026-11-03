import { z } from "zod";
import { isDomainError } from "@/server/domain/errors";
import type { Profile } from "@/server/domain/audit-rules";
import { type ToolName } from "@/server/domain/mcp-scopes";
import { listOpenAlerts } from "@/server/services/alerts";
import { getAudit, getAuditInsights, requestAudit } from "@/server/services/audits";
import { getLatestScores, getRouteHistory } from "@/server/services/history";
import { getProject, listAllProjects } from "@/server/services/projects";
import { addRoute, findOrCreateAdhocRoute, getRoute, listRoutes, setRouteMonitored } from "@/server/services/routes";
import { discoverRoutes } from "@/server/services/sitemap-discovery";
import { getThresholds, setThresholds } from "@/server/services/thresholds";

export type ToolContext = {
  /** Quién llama: se anota en las auditorías que lance. */
  keyName: string;
  /** Pausa entre sondeos de `run_audit` con espera; sustituible en pruebas. */
  sleep?: (ms: number) => Promise<void>;
};

export type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

type ToolDef<S extends z.ZodRawShape> = {
  name: ToolName;
  title: string;
  description: string;
  input: S;
  /** `true` si no modifica nada. */
  readOnly: boolean;
  run: (args: z.infer<z.ZodObject<S>>, ctx: ToolContext) => Promise<unknown>;
};

const uuid = (what: string) => z.uuid({ error: `${what} debe ser un identificador (uuid) obtenido de otra herramienta.` }).describe(what);
const profile = z.enum(["mobile", "desktop"]);

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

function defineTool<S extends z.ZodRawShape>(def: ToolDef<S>) {
  return def;
}

const scoresOf = (a: { scorePerformance: number | null; scoreSeo: number | null; scoreAccessibility: number | null; scoreBestPractices: number | null }) => ({
  performance: a.scorePerformance,
  seo: a.scoreSeo,
  accessibility: a.scoreAccessibility,
  best_practices: a.scoreBestPractices,
});

type AuditRow = Awaited<ReturnType<typeof getAudit>>;
const auditSummary = (a: AuditRow) => ({
  audit_id: a.id,
  status: a.status,
  profile: a.profile,
  route_id: a.routeId,
  route_path: a.routePath,
  project_id: a.projectId,
  queued_at: iso(a.queuedAt),
  finished_at: iso(a.finishedAt),
  attempts: a.attempts,
  ...(a.status === "succeeded"
    ? {
        scores: scoresOf(a),
        lab: { lcp_ms: a.lcpMs, fcp_ms: a.fcpMs, tbt_ms: a.tbtMs, cls: a.cls === null ? null : Number(a.cls), ttfb_ms: a.ttfbMs },
      }
    : {}),
  ...(a.status === "failed" || a.errorCode ? { error: { code: a.errorCode, message: a.errorMessage } } : {}),
});

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const isPending = (s: string) => s === "queued" || s === "running";

export const TOOLS = [
  defineTool({
    name: "list_projects",
    title: "Listar proyectos",
    description: "Lista los proyectos vigentes con su cliente, fase (development/production) y frecuencia. Úsala primero para obtener los project_id.",
    input: { client: z.string().trim().max(100).optional().describe("Filtra por nombre de cliente (contiene, sin distinguir mayúsculas).") },
    readOnly: true,
    run: async ({ client }) => {
      const all = await listAllProjects();
      const q = client?.toLowerCase();
      return {
        projects: all
          .filter((p) => !q || p.clientName.toLowerCase().includes(q))
          .map((p) => ({ project_id: p.id, name: p.name, client: p.clientName, phase: p.phase, base_url: p.baseUrl, audit_frequency: p.auditFrequency })),
      };
    },
  }),

  defineTool({
    name: "get_project",
    title: "Ver un proyecto",
    description: "Detalle de un proyecto: fase, hosts permitidos, rutas, umbrales, alertas abiertas y la última puntuación de cada ruta y perfil con su variación frente a la auditoría anterior.",
    input: { project_id: uuid("project_id") },
    readOnly: true,
    run: async ({ project_id }) => {
      const [project, routes, thresholds, alerts, latest] = await Promise.all([
        getProject(project_id),
        listRoutes(project_id),
        getThresholds(project_id),
        listOpenAlerts(project_id),
        getLatestScores(project_id),
      ]);
      return {
        project: {
          project_id: project.id,
          name: project.name,
          client: project.clientName,
          phase: project.phase,
          base_url: project.baseUrl,
          audit_frequency: project.auditFrequency,
          allowed_hosts: project.allowedHosts,
        },
        routes: routes.map((r) => ({ route_id: r.id, path: r.path, monitored: r.monitored, source: r.source })),
        thresholds: thresholds.map((t) => ({ metric: t.metric, min_score: t.minScore, enabled: t.enabled })),
        open_alerts: alerts.map((a) => ({ route_path: a.routePath, profile: a.profile, summary: a.summary, opened_at: iso(a.openedAt) })),
        latest_scores: latest.map((l) => ({
          route_id: l.routeId,
          path: l.path,
          profile: l.profile,
          audit_id: l.auditId,
          finished_at: iso(l.finishedAt),
          scores: l.scores,
          change_vs_previous: Object.fromEntries(Object.entries(l.changes).map(([k, c]) => [k, c ? `${c.diff > 0 ? "+" : ""}${c.diff}` : null])),
        })),
      };
    },
  }),

  defineTool({
    name: "list_routes",
    title: "Listar rutas",
    description: "Rutas (páginas) de un proyecto. `monitored` indica si entran a las auditorías programadas de producción.",
    input: { project_id: uuid("project_id"), only_monitored: z.boolean().optional().describe("Solo las monitoreadas.") },
    readOnly: true,
    run: async ({ project_id, only_monitored }) => {
      const routes = await listRoutes(project_id);
      return {
        routes: routes
          .filter((r) => !only_monitored || r.monitored)
          .map((r) => ({ route_id: r.id, path: r.path, url: r.url, monitored: r.monitored, source: r.source, label: r.label })),
      };
    },
  }),

  defineTool({
    name: "get_audit_history",
    title: "Historial de una ruta",
    description: "Auditorías correctas de una ruta, de la más reciente a la más antigua, con las cuatro puntuaciones y LCP/TBT/CLS. Sin `profile` devuelve móvil y escritorio.",
    input: {
      route_id: uuid("route_id"),
      profile: profile.optional().describe("mobile o desktop. Por defecto, ambos."),
      days: z.number().int().min(1).max(365).optional().describe("Cuántos días hacia atrás (1-365). Por defecto 30."),
      limit: z.number().int().min(1).max(200).optional().describe("Máximo de auditorías por perfil (1-200). Por defecto 30."),
    },
    readOnly: true,
    run: async ({ route_id, profile: p, days, limit }) => {
      const route = await getRoute(route_id);
      const profiles: Profile[] = p ? [p] : ["mobile", "desktop"];
      const out: Record<string, unknown> = {};
      for (const prof of profiles) {
        const rows = await getRouteHistory({ routeId: route_id, profile: prof, days: days ?? 30, limit: limit ?? 30 });
        out[prof] = rows.map((r) => ({ audit_id: r.auditId, at: iso(r.at), ...r.scores, lcp_ms: r.lcpMs, tbt_ms: r.tbtMs, cls: r.cls }));
      }
      return { route: { route_id: route.id, path: route.path }, days: days ?? 30, history: out };
    },
  }),

  defineTool({
    name: "get_audit",
    title: "Ver una auditoría",
    description: "Resultado de una auditoría. Con `include_details` suma las mejoras principales de Lighthouse y las comprobaciones que fallan por categoría (las explicaciones de por qué sube o baja cada puntuación).",
    input: { audit_id: uuid("audit_id"), include_details: z.boolean().optional().describe("Incluir mejoras y comprobaciones fallidas (lee el informe completo).") },
    readOnly: true,
    run: async ({ audit_id, include_details }) => {
      const audit = await getAudit(audit_id);
      const base = auditSummary(audit);
      if (!include_details) return base;
      const insights = await getAuditInsights(audit);
      if (!insights) return { ...base, details: null, details_note: "No hay informe completo disponible para esta auditoría." };
      return {
        ...base,
        details: {
          opportunities: insights.opportunities.map((o) => ({ title: o.title, savings_ms: o.savingsMs })),
          failed_checks: insights.failed
            .filter((c) => c.failedCount > 0)
            .map((c) => ({
              category: c.category,
              score: c.score,
              failed_total: c.failedCount,
              checks: c.checks.slice(0, 5).map((k) => ({ id: k.id, title: k.title, value: k.displayValue, why: clip(k.description, 280), more_info: k.learnMoreUrl })),
            })),
        },
      };
    },
  }),

  defineTool({
    name: "get_audit_status",
    title: "Estado de auditorías",
    description: "Estado de hasta 10 auditorías (queued, running, succeeded, failed) para consultar el avance de las que lanzó run_audit.",
    input: { audit_ids: z.array(uuid("audit_id")).min(1).max(10).describe("Identificadores de auditoría.") },
    readOnly: true,
    run: async ({ audit_ids }) => ({
      audits: await Promise.all(
        audit_ids.map(async (id) => {
          try {
            return auditSummary(await getAudit(id));
          } catch (err) {
            if (isDomainError(err) && err.code === "NOT_FOUND") return { audit_id: id, status: "not_found" };
            throw err;
          }
        }),
      ),
    }),
  }),

  defineTool({
    name: "get_thresholds",
    title: "Ver umbrales",
    description: "Puntuación mínima aceptable por métrica en un proyecto. Bajo ese valor, en producción, se abre una alerta.",
    input: { project_id: uuid("project_id") },
    readOnly: true,
    run: async ({ project_id }) => ({
      thresholds: (await getThresholds(project_id)).map((t) => ({ metric: t.metric, min_score: t.minScore, enabled: t.enabled })),
    }),
  }),

  defineTool({
    name: "run_audit",
    title: "Lanzar una auditoría",
    description:
      "Encola una auditoría de Lighthouse. Indica `route_id`, o `project_id` + `url` (ruta o URL completa de un host permitido; se crea como ruta puntual sin monitoreo). " +
      "En producción sin `profile` se auditan móvil y escritorio; en desarrollo `profile` es obligatorio. Si ya hay una pendiente para esa ruta y perfil, la devuelve. " +
      "Las auditorías corren de una en una en un servidor compartido: pueden tardar. Con `wait_seconds` espera el resultado hasta ese tiempo; si no termina, consulta después con get_audit_status.",
    input: {
      route_id: uuid("route_id").optional(),
      project_id: uuid("project_id").optional(),
      url: z.string().trim().min(1).max(500).optional().describe("Ruta (/contacto) o URL completa del sitio del proyecto."),
      profile: profile.optional(),
      wait_seconds: z.number().int().min(0).max(45).optional().describe("Esperar el resultado hasta este tiempo (0-45 s). Por defecto 0."),
    },
    readOnly: false,
    run: async ({ route_id, project_id, url, profile: p, wait_seconds }, ctx) => {
      let routeId = route_id;
      if (!routeId) {
        if (!project_id || !url) {
          return { error: "Indica route_id, o project_id junto con url." };
        }
        routeId = (await findOrCreateAdhocRoute(project_id, url)).id;
      }
      const result = await requestAudit({ routeId, profiles: p ? [p] : undefined, trigger: "mcp", requestedBy: `mcp:${ctx.keyName}` });
      let audits: Array<{ id: string; status: string }> = result.audits;
      const waitMs = (wait_seconds ?? 0) * 1000;
      if (waitMs > 0) {
        const sleep = ctx.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
        const end = Date.now() + waitMs;
        for (;;) {
          audits = await Promise.all(audits.map((a) => getAudit(a.id)));
          if (!audits.some((a) => isPending(a.status)) || Date.now() >= end) break;
          await sleep(Math.min(2000, Math.max(100, end - Date.now())));
        }
      }
      const rows = await Promise.all(audits.map((a) => getAudit(a.id)));
      return {
        created: result.created,
        already_pending: result.alreadyPending,
        audits: rows.map(auditSummary),
        note: rows.some((a) => isPending(a.status)) ? "Aún en proceso: consulta get_audit_status con los audit_id." : undefined,
      };
    },
  }),

  defineTool({
    name: "discover_routes",
    title: "Descubrir rutas en el sitemap",
    description: "Lee el sitemap del proyecto y propone rutas que aún no están agregadas. No agrega nada: usa add_route para las que quieras.",
    input: { project_id: uuid("project_id") },
    readOnly: true,
    run: async ({ project_id }) => {
      const r = await discoverRoutes(project_id);
      return {
        sitemap_url: r.sitemapUrl,
        candidates: r.candidates.slice(0, 100).map((c) => c.path),
        candidates_total: r.candidates.length,
        already_added: r.alreadyAdded,
        other_hosts_skipped: r.otherHosts,
        truncated: r.truncated || r.candidates.length > 100,
      };
    },
  }),

  defineTool({
    name: "set_thresholds",
    title: "Cambiar umbrales",
    description: "Cambia la puntuación mínima de una o más métricas de un proyecto (performance, seo, accessibility, best_practices). Solo toca las métricas indicadas.",
    input: {
      project_id: uuid("project_id"),
      thresholds: z
        .array(
          z.object({
            metric: z.enum(["performance", "seo", "accessibility", "best_practices"]),
            min_score: z.number().int().min(0).max(100),
            enabled: z.boolean().optional().describe("false desactiva las alertas de esa métrica. Por defecto true."),
          }),
        )
        .min(1)
        .max(4),
    },
    readOnly: false,
    run: async ({ project_id, thresholds }) => {
      const saved = await setThresholds(
        project_id,
        thresholds.map((t) => ({ metric: t.metric, minScore: t.min_score, enabled: t.enabled ?? true })),
      );
      return { thresholds: saved.map((t) => ({ metric: t.metric, min_score: t.minScore, enabled: t.enabled })) };
    },
  }),

  defineTool({
    name: "add_route",
    title: "Agregar una ruta",
    description: "Agrega una ruta al proyecto y la deja monitoreada (entra a las auditorías programadas de producción). Acepta /ruta o una URL de un host permitido.",
    input: { project_id: uuid("project_id"), path: z.string().trim().min(1).max(500), label: z.string().trim().max(120).optional() },
    readOnly: false,
    run: async ({ project_id, path, label }) => {
      const r = await addRoute(project_id, { path, label });
      return { route: { route_id: r.id, path: r.path, url: r.url, monitored: r.monitored } };
    },
  }),

  defineTool({
    name: "set_route_monitored",
    title: "Monitorear o dejar de monitorear una ruta",
    description: "Activa o desactiva el monitoreo programado de una ruta. Conserva su historial; no la borra.",
    input: { route_id: uuid("route_id"), monitored: z.boolean() },
    readOnly: false,
    run: async ({ route_id, monitored }) => {
      const r = await setRouteMonitored(route_id, monitored);
      return { route: { route_id: r.id, path: r.path, monitored: r.monitored } };
    },
  }),
];

/** Texto de error seguro para devolver al agente: los de negocio se dicen tal cual, el resto no se detalla. */
export function describeError(err: unknown): string {
  if (isDomainError(err)) return err.message;
  if (err instanceof z.ZodError) return err.issues[0]?.message ?? "Parámetros no válidos.";
  return "Error inesperado en el servidor.";
}

// Control en tiempo de compilación y de prueba: cada herramienta del catálogo existe una vez.
export const TOOL_NAMES: readonly ToolName[] = TOOLS.map((t) => t.name);
