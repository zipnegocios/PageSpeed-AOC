"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { field, guarded, type ActionState } from "@/lib/actions";
import { verifySession } from "@/lib/auth/session";
import { clientPath, projectPath } from "@/lib/urls";
import { parsePeriod } from "@/server/domain/history";
import { requestAudit } from "@/server/services/audits";
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
 * Solicita auditar una ruta. En desarrollo el formulario trae el perfil elegido; en producción
 * no trae ninguno y se auditan ambos (móvil y escritorio).
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
