import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb, type Database } from "@/server/db/client";
import { projects } from "@/server/db/schema";
import { logoInfo, type ClientLogoInfo } from "@/server/domain/client-logo";
import { formatImpact, plainImprovement } from "@/server/domain/improvement-glossary";
import { categoryOfMetric, type ImprovementCategory } from "@/server/domain/improvements";
import { pathTitle, resolveTitles } from "@/server/domain/page-title";
import { buildRouteTree, countPages, type ProfileScores, type TreeNode, type TreePage } from "@/server/domain/route-tree";
import { isValidSlug } from "@/server/domain/slug";
import { findClientBySlug, findClientByToken } from "@/server/repositories/clients";
import { latestCrawlTitles } from "@/server/repositories/seo-crawl";
import type { R2Store } from "@/server/storage/r2";
import { listOpenAlertConditions, listOpenAlerts, type AlertView } from "./alerts";
import { averageScores, getLatestScores, type LatestScores } from "./history";
import { assertUuid } from "./shared";
import { getAudit, getSiblingAudits, type AuditDetail, type SiblingAudits } from "./audits";
import { loadAuditImprovements } from "./audit-improvements";
import { getRoute, listRoutes } from "./routes";
import { getMarkets } from "./seo-markets";

/** El token es de 32 bytes en base64url: 43 caracteres. Todo lo demás se descarta sin tocar la base de datos. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const isPlausibleToken = (token: string) => TOKEN_RE.test(token);

/** El cliente del portal. `logo` solo viaja con el acceso ya concedido: nunca en las pantallas de PIN, bloqueo o suspensión. */
export type PortalClient = { id: string; name: string; logo?: ClientLogoInfo };

export type PortalAccess =
  | { state: "invalid" }
  /** Enlace antiguo con token: ya no da acceso, solo lleva al portal con PIN. */
  | { state: "legacy"; slug: string }
  | { state: "suspended"; clientName: string }
  /** Pide el PIN. También para un identificador que no existe: así no se puede averiguar qué clientes hay. */
  | { state: "pin" }
  | { state: "ok"; client: PortalClient };

/** ¿El navegador trae una sesión vigente para este cliente? Lo decide quien llama (lee la cookie). */
export type SessionCheck = (client: { id: string; pinVersion: number }) => Promise<boolean>;

/**
 * Resuelve el enlace del portal: `/c/<identificador-del-cliente>` (un identificador anterior también vale). El acceso
 * exige el PIN, ya validado en una sesión. Un cliente suspendido ve su aviso sin PIN. Se comprueba en cada petición,
 * así que suspender o generar un PIN nuevo surte efecto al instante.
 */
export async function resolvePortal(ref: string, hasSession: SessionCheck, db: Database = getDb()): Promise<PortalAccess> {
  if (isPlausibleToken(ref)) {
    const old = await findClientByToken(db, ref);
    return old ? { state: "legacy", slug: old.slug } : { state: "invalid" };
  }
  if (!isValidSlug(ref)) return { state: "invalid" };
  const client = await findClientBySlug(db, ref);
  if (!client) return { state: "pin" };
  if (client.status === "suspended") return { state: "suspended", clientName: client.name };
  if (client.pinHash && (await hasSession({ id: client.id, pinVersion: client.pinVersion }))) {
    const logo = logoInfo(client);
    return { state: "ok", client: { id: client.id, name: client.name, ...(logo ? { logo } : {}) } };
  }
  return { state: "pin" };
}

export type PortalProjectSummary = {
  id: string;
  slug: string;
  name: string;
  baseUrl: string;
  lastAuditAt: Date | null;
  averages: LatestScores["scores"];
  openAlerts: number;
};

/** Solo proyectos en producción y no archivados: lo que se monitorea de verdad. */
async function productionProjects(db: Database, clientId: string) {
  return db
    .select({ id: projects.id, slug: projects.slug, slugAliases: projects.slugAliases, name: projects.name, baseUrl: projects.baseUrl })
    .from(projects)
    .where(and(eq(projects.clientId, clientId), eq(projects.phase, "production"), isNull(projects.deletedAt)))
    .orderBy(asc(projects.name));
}

export async function getPortalOverview(clientId: string, db: Database = getDb()): Promise<PortalProjectSummary[]> {
  assertUuid(clientId, "Cliente");
  const list = await productionProjects(db, clientId);
  return Promise.all(
    list.map(async (p) => {
      const [latest, alerts] = await Promise.all([getLatestScores(p.id, db), listOpenAlerts(p.id, db)]);
      return {
        ...p,
        lastAuditAt: latest.reduce<Date | null>((max, l) => (max === null || l.finishedAt > max ? l.finishedAt : max), null),
        averages: averageScores(latest),
        openAlerts: alerts.length,
      };
    }),
  );
}

export type PortalProject = {
  id: string;
  slug: string;
  name: string;
  baseUrl: string;
  latest: LatestScores[];
  /** Lo que está por debajo de la meta; sin datos internos. */
  improvements: Array<Pick<AlertView, "id" | "kind" | "routePath" | "profile" | "summary" | "openedAt">>;
};

/**
 * null si el proyecto no es de este cliente, no está en producción o está archivado. `ref` es el identificador
 * legible (slug) del proyecto o, para enlaces antiguos, su UUID.
 */
export async function getPortalProject(clientId: string, ref: string, db: Database = getDb()): Promise<PortalProject | null> {
  assertUuid(clientId, "Cliente");
  const found = (await productionProjects(db, clientId)).find((p) => p.slug === ref || p.slugAliases.includes(ref) || p.id === ref);
  const project = found ? { id: found.id, slug: found.slug, name: found.name, baseUrl: found.baseUrl } : undefined;
  if (!project) return null;
  const [latest, alerts] = await Promise.all([getLatestScores(project.id, db), listOpenAlerts(project.id, db)]);
  return {
    ...project,
    latest,
    improvements: alerts.map(({ id, kind, routePath, profile, summary, openedAt }) => ({ id, kind, routePath, profile, summary, openedAt })),
  };
}

export type PortalAudit = {
  audit: AuditDetail;
  /** Identificador legible del proyecto, para armar los enlaces. */
  projectSlug: string;
  /** La ruta exige sesión: al cliente no se le muestran capturas ni fragmentos de HTML. */
  redact: boolean;
};

/** Auditoría correcta de un proyecto del cliente. null si no existe, no es suya o no terminó bien. */
export async function getPortalAudit(clientId: string, projectId: string, auditId: string, db: Database = getDb()): Promise<PortalAudit | null> {
  if (!/^[0-9a-f-]{36}$/i.test(auditId)) return null;
  const project = await getPortalProject(clientId, projectId, db);
  if (!project) return null;
  try {
    const audit = await getAudit(auditId, db);
    if (audit.projectId !== project.id || audit.status !== "succeeded") return null;
    const route = await getRoute(audit.routeId, db);
    return { audit, projectSlug: project.slug, redact: route.requiresAuth };
  } catch {
    return null;
  }
}

/**
 * El otro dispositivo de la misma página, para el selector del detalle técnico. Las mismas barreras que `getPortalAudit`
 * (proyecto del cliente, en producción, auditoría correcta); null si no se puede ver.
 */
export async function getPortalSiblings(clientId: string, projectId: string, auditId: string, db: Database = getDb()): Promise<SiblingAudits | null> {
  const found = await getPortalAudit(clientId, projectId, auditId, db);
  return found ? getSiblingAudits(auditId, db) : null;
}

/** Lo que el portal muestra de un perfil (móvil o escritorio) de una página: puntuaciones, métricas y la auditoría a la que enlaza. */
export type PortalProfileView = ProfileScores & {
  auditId: string;
  finishedAt: Date;
  metrics: LatestScores["metrics"];
  changes: LatestScores["changes"];
};
export type PortalTreeNode = TreeNode<PortalProfileView>;
export type PortalRouteTree = { nodes: PortalTreeNode[]; pages: number; improvements: number };

/**
 * El árbol de páginas de un proyecto para la pestaña «Rutas»: una entrada por ruta monitoreada con sus últimas auditorías,
 * las mejoras abiertas por ruta (que suben a los padres) y el título que verá el cliente. Título: etiqueta del
 * administrador → título del último rastreo (solo páginas que respondieron 200 sin redirección y no exigen sesión) → ruta.
 */
/**
 * El título que verá el cliente para cada ruta pedida: etiqueta del administrador → título del último rastreo (solo si la
 * página respondió 200 sin redirección y no exige sesión) → último segmento de la ruta.
 */
export async function portalPageTitles(project: { id: string; name: string }, paths: string[], db: Database): Promise<Map<string, string>> {
  const [routes, crawl] = await Promise.all([listRoutes(project.id, db), latestCrawlTitles(db, project.id)]);
  const meta = new Map(routes.map((r) => [r.path, r]));
  const crawlBy = new Map(crawl.map((c) => [c.path, c]));
  return resolveTitles(
    paths.map((path) => {
      const c = crawlBy.get(path);
      const trusted = c && c.status === 200 && (c.finalPath === null || c.finalPath === path) && !meta.get(path)?.requiresAuth;
      return { path, label: meta.get(path)?.label ?? null, crawlTitle: trusted ? c.title : null };
    }),
    project.name,
    crawl.filter((c) => c.path !== "/").map((c) => c.title),
  );
}

export async function getPortalRouteTree(project: PortalProject, db: Database = getDb()): Promise<PortalRouteTree> {
  const markets = await getMarkets(project.id, db);
  const improvementsBy = new Map<string, number>();
  for (const a of project.improvements) improvementsBy.set(a.routePath, (improvementsBy.get(a.routePath) ?? 0) + 1);

  const byRoute = new Map<string, TreePage<PortalProfileView>>();
  for (const l of project.latest) {
    const page = byRoute.get(l.routeId) ?? { routeId: l.routeId, path: l.path, title: "", improvements: improvementsBy.get(l.path) ?? 0, profiles: {} };
    page.profiles[l.profile] = { scores: l.scores, agentic: l.agentic, auditId: l.auditId, finishedAt: l.finishedAt, metrics: l.metrics, changes: l.changes };
    byRoute.set(l.routeId, page);
  }
  const pages = [...byRoute.values()];
  const titles = await portalPageTitles(project, pages.map((p) => p.path), db);
  for (const p of pages) p.title = titles.get(p.path) ?? pathTitle(p.path);

  const marketTitle = new Map(markets.filter((m) => m.prefix).map((m) => [m.prefix, m.label]));
  const nodes = buildRouteTree(pages, (path) => marketTitle.get(path) ?? pathTitle(path));
  return { nodes, pages: countPages(nodes), improvements: project.improvements.length };
}

// ----------------------------------------------------------------------------- mejoras

export type PortalImprovementItem = { id: string; /** La frase llana (glosario) o, sin él, el título de Lighthouse. */ text: string; /** «≈ 1,9 s», «3 elementos»; vacío si no hay dato. */ impact: string };

export type PortalImprovementBlock = {
  profile: "mobile" | "desktop";
  kind: "threshold" | "audit_failure";
  category: ImprovementCategory | null;
  /** Nota actual y meta acordada del rubro. */
  value: number | null;
  threshold: number | null;
  /** La última auditoría de esa página y dispositivo, para enlazar al detalle de ingeniería. */
  auditId: string | null;
  items: PortalImprovementItem[];
};

export type PortalImprovementPage = { path: string; title: string; blocks: PortalImprovementBlock[] };
export type PortalImprovements = { pages: PortalImprovementPage[]; total: number };

const CATEGORY_ORDER: ImprovementCategory[] = ["performance", "accessibility", "seo", "best-practices"];

/**
 * Lo que hay que mejorar, página por página: cada alerta abierta (rubro por debajo de la meta, por dispositivo) con las causas
 * concretas que Lighthouse encontró en la última auditoría de esa página, en frases llanas y con su impacto. Las causas salen
 * de lo guardado al terminar cada auditoría; una auditoría anterior se lee de R2 una vez y queda guardada.
 */
export async function getPortalImprovements(project: PortalProject, db: Database = getDb(), deps: { r2?: Pick<R2Store, "getAuditJson"> } = {}): Promise<PortalImprovements> {
  const conditions = await listOpenAlertConditions(project.id, db);
  if (conditions.length === 0) return { pages: [], total: 0 };
  const latest = new Map(project.latest.map((l) => [`${l.path}|${l.profile}`, l]));
  const auditIds = [...new Set(conditions.flatMap((c) => (c.kind === "threshold" ? [latest.get(`${c.routePath}|${c.profile}`)?.auditId] : [])).filter((x): x is string => Boolean(x)))];

  const byAudit = await loadAuditImprovements(auditIds, db, deps);

  const titles = await portalPageTitles(project, [...new Set(conditions.map((c) => c.routePath))], db);
  const pages = new Map<string, PortalImprovementPage>();
  for (const c of conditions) {
    const page = pages.get(c.routePath) ?? { path: c.routePath, title: titles.get(c.routePath) ?? pathTitle(c.routePath), blocks: [] };
    const auditId = latest.get(`${c.routePath}|${c.profile}`)?.auditId ?? null;
    const category = c.metric ? categoryOfMetric(c.metric) : null;
    const items = category && auditId ? (byAudit.get(auditId)?.categories[category] ?? []) : [];
    page.blocks.push({
      profile: c.profile,
      kind: c.kind,
      category,
      value: c.value,
      threshold: c.threshold,
      auditId,
      items: items.map((i) => ({ id: i.id, text: plainImprovement(i), impact: formatImpact(i.impact) })),
    });
    pages.set(c.routePath, page);
  }
  for (const page of pages.values()) {
    page.blocks.sort((a, b) => CATEGORY_ORDER.indexOf(a.category ?? "performance") - CATEGORY_ORDER.indexOf(b.category ?? "performance") || a.profile.localeCompare(b.profile));
  }
  const worst = (p: PortalImprovementPage) => Math.min(...p.blocks.map((b) => (b.kind === "audit_failure" ? -1 : (b.value ?? 101))));
  const sorted = [...pages.values()].sort((a, b) => b.blocks.length - a.blocks.length || worst(a) - worst(b) || a.title.localeCompare(b.title, "es"));
  return { pages: sorted, total: conditions.length };
}
