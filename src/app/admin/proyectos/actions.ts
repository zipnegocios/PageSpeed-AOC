"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { field, guarded, type ActionState } from "@/lib/actions";
import { verifySession } from "@/lib/auth/session";
import { clientPath, projectPath } from "@/lib/urls";
import { parsePeriod } from "@/server/domain/history";
import { MAX_WAITING_JOBS, requestAudit, requestFirstScan } from "@/server/services/audits";
import { sendProjectReport } from "@/server/services/report-email";
import { requestFieldDataRefresh } from "@/server/services/crux";
import { clearProjectAuth, setProjectAuth } from "@/server/services/project-auth";
import * as clients from "@/server/services/clients";
import * as projects from "@/server/services/projects";
import * as routes from "@/server/services/routes";
import { discoverRoutes, importRoutes } from "@/server/services/sitemap-discovery";
import { METRICS } from "@/server/services/settings";
import * as thresholds from "@/server/services/thresholds";

/** Las direcciones llevan slugs de cliente y proyecto: se revalida todo el panel en lugar de adivinar cada ruta. */
const refresh = (_projectId?: string) => revalidatePath("/admin", "layout");

export async function updateProjectAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    await projects.updateProject(id, {
      name: field(fd, "name"),
      baseUrl: field(fd, "baseUrl"),
      auditFrequency: field(fd, "auditFrequency"),
      sitemapUrl: field(fd, "sitemapUrl"),
      allowedHosts: field(fd, "allowedHosts"),
    });
    refresh(id);
    return { ok: "Ajustes guardados." };
  });
}

export async function setPhaseAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    const { suppressedAlerts, project, scheduler } = await projects.setProjectPhase(id, field(fd, "phase"));
    refresh(id);
    const label = project.phase === "production" ? "producción" : "desarrollo";
    const notes = [
      suppressedAlerts > 0 ? `se silenciaron ${suppressedAlerts} alertas abiertas` : "",
      scheduler.cancelled > 0 ? `se cancelaron ${scheduler.cancelled} auditorías programadas pendientes` : "",
      !scheduler.ok ? "no se pudo actualizar el agendado (Redis no respondió); se corregirá solo en unos minutos" : "",
    ].filter(Boolean);
    return { ok: `Fase cambiada a ${label}${notes.length ? `: ${notes.join("; ")}` : ""}.` };
  });
}

export async function setThresholdsAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    await thresholds.setThresholds(
      id,
      METRICS.map((metric) => ({
        metric,
        minScore: field(fd, `score_${metric}`),
        enabled: fd.get(`enabled_${metric}`) === "on",
      })),
    );
    refresh(id);
    return { ok: "Umbrales guardados." };
  });
}

export async function addRouteAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    const route = await routes.addRoute(id, {
      path: field(fd, "path"),
      label: field(fd, "label"),
      requiresAuth: fd.get("requiresAuth") === "on",
    });
    refresh(id);
    return { ok: `Ruta ${route.path} agregada.` };
  });
}

export async function toggleRouteAction(
  projectId: string,
  routeId: string,
  monitored: boolean,
  _prev: ActionState,
): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    await routes.setRouteMonitored(routeId, monitored);
    refresh(projectId);
  });
}

export async function removeRouteAction(projectId: string, routeId: string, _prev: ActionState): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    await routes.removeRoute(routeId);
    refresh(projectId);
  });
}

export async function discoverRoutesAction(id: string, _prev: ActionState): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    const found = await discoverRoutes(id);
    refresh(id);
    const notes = [
      found.alreadyAdded ? `${found.alreadyAdded} ya estaban agregadas` : "",
      found.otherHosts ? `${found.otherHosts} de otros hosts se ignoraron` : "",
      found.truncated ? "la lista se recortó a 500 rutas" : "",
    ].filter(Boolean);
    return {
      candidates: found.candidates,
      ok:
        found.candidates.length === 0
          ? `No hay rutas nuevas en ${found.sitemapUrl}${notes.length ? ` (${notes.join(", ")})` : ""}.`
          : `${found.candidates.length} rutas nuevas encontradas${notes.length ? ` (${notes.join(", ")})` : ""}.`,
    };
  });
}

export async function importRoutesAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    const result = await importRoutes(
      id,
      fd.getAll("path").map((p) => String(p)),
    );
    refresh(id);
    return { ok: `${result.added} rutas activadas para monitoreo${result.skipped ? ` (${result.skipped} ya existían)` : ""}.` };
  });
}

export async function renameProjectSlugAction(id: string, clientSlug: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    const project = await projects.renameProjectSlug(id, field(fd, "slug"));
    refresh();
    redirect(projectPath(clientSlug, project.slug));
  });
}

export async function archiveProjectAction(id: string, clientId: string, _prev: ActionState): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    const client = await clients.getClient(clientId);
    await projects.archiveProject(id);
    refresh();
    redirect(clientPath(client.slug));
  });
}

/**
 * Solicita auditar una ruta. El formulario trae el perfil elegido («mobile» o «desktop»); sin perfil
 * (o con «both») se auditan los dos, móvil y escritorio, en cualquier fase.
 */
export async function requestAuditAction(
  projectId: string,
  routeId: string,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const session = await verifySession();
  return guarded(async () => {
    const profile = field(fd, "profile");
    const result = await requestAudit({
      routeId,
      profiles: profile === "mobile" || profile === "desktop" ? [profile] : undefined,
      trigger: "manual",
      requestedBy: session.email,
    });
    refresh(projectId);
    if (result.created === 0) return { ok: "Ya había una auditoría pendiente para esta ruta." };
    return { ok: result.created === 1 ? "Auditoría en cola." : `${result.created} auditorías en cola (móvil y escritorio).` };
  });
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Primer escaneo de todas las rutas monitoreadas del proyecto, en móvil y escritorio. Solo encola lo que aún no tiene
 * una auditoría correcta ni pendiente, así que se puede pulsar otra vez cuando la cola avance.
 */
export async function firstScanAction(projectId: string, _prev: ActionState): Promise<ActionState> {
  const session = await verifySession();
  return guarded(async () => {
    const r = await requestFirstScan(projectId, session.email);
    refresh(projectId);
    const head =
      r.created > 0
        ? `${plural(r.created, "auditoría en cola", "auditorías en cola")} de ${plural(r.routes, "ruta", "rutas")} (móvil y escritorio).`
        : r.routesWithoutRoom > 0
          ? "No se encoló nada: la cola está llena."
          : r.alreadyPending > 0
            ? "No hay nada nuevo que encolar."
            : "Todas las rutas ya tienen su primer escaneo.";
    const notes = [
      r.created > 0 && r.alreadyPending > 0 ? `${plural(r.alreadyPending, "dispositivo ya estaba", "dispositivos ya estaban")} en cola o en curso.` : "",
      r.created === 0 && r.alreadyPending > 0 ? `Ya hay ${plural(r.alreadyPending, "auditoría", "auditorías")} en cola o en curso.` : "",
      r.skippedAuth > 0 ? `${plural(r.skippedAuth, "ruta con sesión se omitió", "rutas con sesión se omitieron")}: configura el acceso a páginas privadas.` : "",
      r.skippedHost > 0 ? `${plural(r.skippedHost, "ruta se omitió", "rutas se omitieron")} porque su host ya no está permitido.` : "",
      r.routesWithoutRoom > 0 ? `Faltan ${plural(r.routesWithoutRoom, "ruta", "rutas")}: la cola admite ${MAX_WAITING_JOBS} trabajos; vuelve a pulsar cuando avance.` : "",
    ].filter(Boolean);
    return { ok: [head, ...notes].join(" ") };
  });
}

export async function sendReportAction(projectId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    const { to } = await sendProjectReport(projectId, parsePeriod(field(fd, "dias")));
    refresh(projectId);
    return { ok: `Informe enviado a ${to}.` };
  });
}

export async function toggleRouteAuthAction(projectId: string, routeId: string, requiresAuth: boolean, _prev: ActionState): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    await routes.updateRouteDetails(routeId, { requiresAuth });
    refresh(projectId);
  });
}

/** El nombre que verá el cliente en su portal para esta página (vacío = el título del rastreo o, a falta, la ruta). */
export async function updateRouteLabelAction(projectId: string, routeId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    await routes.updateRouteDetails(routeId, { label: field(fd, "label").slice(0, 120) });
    refresh(projectId);
    return { ok: "Nombre guardado." };
  });
}

export async function saveFormAuthAction(projectId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    await setProjectAuth(projectId, {
      strategy: "form",
      loginUrl: field(fd, "loginUrl"),
      username: field(fd, "username"),
      password: field(fd, "password"),
      usernameSelector: field(fd, "usernameSelector"),
      passwordSelector: field(fd, "passwordSelector"),
      submitSelector: field(fd, "submitSelector"),
      successSelector: field(fd, "successSelector"),
    });
    refresh(projectId);
    return { ok: "Acceso por formulario guardado (cifrado). Marca como «Requiere sesión» las rutas privadas." };
  });
}

export async function saveCookieAuthAction(projectId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    await setProjectAuth(projectId, { strategy: "cookie", cookies: field(fd, "cookies") });
    refresh(projectId);
    return { ok: "Cookies guardadas (cifradas). Marca como «Requiere sesión» las rutas privadas." };
  });
}

export async function clearAuthAction(projectId: string, _prev: ActionState): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    await clearProjectAuth(projectId);
    refresh(projectId);
    return { ok: "Acceso eliminado. Las rutas que requieren sesión fallarán hasta configurar uno nuevo." };
  });
}

export async function refreshFieldDataAction(projectId: string, _prev: ActionState): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    const { queued } = await requestFieldDataRefresh(projectId);
    refresh(projectId);
    return { ok: queued ? "Actualización pedida al worker. Los datos aparecerán en unos minutos." : "Ya hay una actualización en curso o esperando al worker." };
  });
}
