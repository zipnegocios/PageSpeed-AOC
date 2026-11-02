"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { field, guarded, type ActionState } from "@/lib/actions";
import { verifySession } from "@/lib/auth/session";
import { requestAudit } from "@/server/services/audits";
import * as projects from "@/server/services/projects";
import * as routes from "@/server/services/routes";
import { discoverRoutes, importRoutes } from "@/server/services/sitemap-discovery";
import { METRICS } from "@/server/services/settings";
import * as thresholds from "@/server/services/thresholds";

const refresh = (projectId: string) => revalidatePath(`/admin/proyectos/${projectId}`);

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
    const { suppressedAlerts, project } = await projects.setProjectPhase(id, field(fd, "phase"));
    refresh(id);
    const label = project.phase === "production" ? "producción" : "desarrollo";
    return {
      ok:
        suppressedAlerts > 0
          ? `Fase cambiada a ${label}. Se silenciaron ${suppressedAlerts} alertas abiertas.`
          : `Fase cambiada a ${label}.`,
    };
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

export async function archiveProjectAction(id: string, clientId: string, _prev: ActionState): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    await projects.archiveProject(id);
    revalidatePath(`/admin/clientes/${clientId}`);
    redirect(`/admin/clientes/${clientId}`);
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
