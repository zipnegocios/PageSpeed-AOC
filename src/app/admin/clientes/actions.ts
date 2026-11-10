"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { field, guarded, type ActionState } from "@/lib/actions";
import { requireClientAccess, requireManageClient, requireManageProject, requireProjectAccess } from "@/lib/auth/access";
import { verifySession } from "@/lib/auth/session";
import { clientPath, projectPath } from "@/lib/urls";
import { DomainError } from "@/server/domain/errors";
import { isLogoKind } from "@/server/domain/client-logo";
import * as clientLogo from "@/server/services/client-logo";
import * as clients from "@/server/services/clients";
import { addProjectAction, confirmServerCheck, removeProjectAction, sendClientReport, setReportPreferences } from "@/server/services/client-reports";
import { getClientSharing, getProjectSharing, setClientShare, setProjectShare } from "@/server/services/team-access";
import { assignClientOwner } from "@/server/services/client-sender";
import { sendClientWelcome } from "@/server/services/client-welcome";
import { generateClientPin } from "@/server/services/portal-pin";
import * as projects from "@/server/services/projects";

/** Las direcciones llevan slugs: se revalida todo el panel en lugar de adivinar cada ruta. */
const revalidateAdmin = () => revalidatePath("/admin", "layout");

const contact = (fd: FormData) => ({
  name: field(fd, "name"),
  contactName: field(fd, "contactName"),
  contactEmail: field(fd, "contactEmail"),
  contactPhone: field(fd, "contactPhone"),
  notes: field(fd, "notes"),
});

export async function createClientAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await verifySession();
  return guarded(async () => {
    // Quien crea el cliente queda como su responsable: firma sus correos, recibe sus alertas y es el contacto de su portal.
    const client = await clients.createClient({ ...contact(fd), slug: field(fd, "slug") }, undefined, { ownerId: session.id });
    revalidatePath("/admin/clientes");
    redirect(clientPath(client.slug));
  });
}

export async function updateClientAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return guarded(async () => {
    await requireClientAccess(id);
    await clients.updateClient(id, contact(fd));
    revalidateAdmin();
    return { ok: "Datos guardados." };
  });
}

export async function setClientStatusAction(
  id: string,
  status: "active" | "suspended",
  _prev: ActionState,
): Promise<ActionState> {
  return guarded(async () => {
    await requireManageClient(id);
    await clients.setClientStatus(id, status);
    revalidateAdmin();
    return { ok: status === "suspended" ? "Cliente suspendido." : "Cliente activado." };
  });
}

export async function renameClientSlugAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return guarded(async () => {
    await requireClientAccess(id);
    const client = await clients.renameClientSlug(id, field(fd, "slug"));
    revalidateAdmin();
    // La dirección actual cambió: se abre la nueva.
    redirect(clientPath(client.slug));
  });
}

export async function generatePinAction(id: string, _prev: ActionState): Promise<ActionState> {
  return guarded(async () => {
    await requireClientAccess(id);
    await generateClientPin(id);
    revalidateAdmin();
    return { ok: "PIN generado. El anterior y las sesiones abiertas del cliente ya no valen." };
  });
}

export async function generateAndEmailPinAction(id: string, _prev: ActionState): Promise<ActionState> {
  return guarded(async () => {
    await requireClientAccess(id);
    const { to } = await generateClientPin(id, { email: true });
    revalidateAdmin();
    return { ok: `PIN generado y enviado a ${to}. El anterior y las sesiones abiertas del cliente ya no valen.` };
  });
}

export async function sendWelcomeAction(clientId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return guarded(async () => {
    const session = await requireClientAccess(clientId);
    const test = fd.get("test") === "on";
    const result = await sendClientWelcome(
      clientId,
      {
        projectId: field(fd, "projectId"),
        kind: field(fd, "kind"),
        techLabel: field(fd, "techLabel"),
        includesServer: fd.get("includesServer") === "on",
        ccText: (fd.get("ccText") as string | null) ?? "",
      },
      test ? { testTo: session.email } : {},
    );
    revalidateAdmin();
    if (result.test) return { ok: `Prueba enviada a ${result.to}. No se guardó nada ni se envió al cliente.` };
    const copy = result.cc.length > 0 ? `, con copia a ${result.cc.join(", ")}` : "";
    const pin = result.newPin ? " Se generó un PIN nuevo y ya vale." : " Lleva el PIN actual.";
    return { ok: `Bienvenida enviada a ${result.to}${copy}.${pin}` };
  });
}

export async function setReportPreferencesAction(clientId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return guarded(async () => {
    await requireClientAccess(clientId);
    const weekly = fd.get("weekly") === "on";
    const monthly = fd.get("monthly") === "on";
    await setReportPreferences(clientId, { weekly, monthly });
    revalidateAdmin();
    if (!weekly && !monthly) return { ok: "Correos automáticos apagados para este cliente." };
    return { ok: `Guardado. ${[weekly ? "Semanal encendido" : null, monthly ? "Mensual encendido" : null].filter(Boolean).join(" · ")}.` };
  });
}

export async function addProjectActionAction(projectId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return guarded(async () => {
    await requireProjectAccess(projectId);
    await addProjectAction(projectId, { date: field(fd, "date"), text: field(fd, "text") });
    revalidateAdmin();
    return { ok: "Anotado. Saldrá en el correo mensual del mes en que ocurrió." };
  });
}

export async function removeProjectActionAction(projectId: string, actionId: string, _prev: ActionState): Promise<ActionState> {
  return guarded(async () => {
    await requireProjectAccess(projectId);
    await removeProjectAction(projectId, actionId);
    revalidateAdmin();
    return { ok: "Borrada." };
  });
}

export async function confirmServerCheckAction(projectId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return guarded(async () => {
    await requireProjectAccess(projectId);
    await confirmServerCheck(projectId, field(fd, "month"));
    revalidateAdmin();
    return { ok: "Confirmado. El correo mensual podrá decir que el servidor se revisó ese mes." };
  });
}

export async function sendReportTestAction(kind: "weekly" | "monthly", projectId: string, _prev: ActionState): Promise<ActionState> {
  return guarded(async () => {
    const session = await requireProjectAccess(projectId);
    const r = await sendClientReport(kind, projectId, { testTo: session.email });
    return { ok: `Prueba enviada a ${r.status === "sent" ? r.to : session.email}, con los datos reales del último ${kind === "weekly" ? "periodo semanal" : "mes completo"}. No se envió al cliente.` };
  });
}

export async function assignClientOwnerAction(clientId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return guarded(async () => {
    await requireManageClient(clientId);
    await assignClientOwner(clientId, field(fd, "ownerId"));
    revalidateAdmin();
    return { ok: "Responsable cambiado. Desde ahora firma los correos de este cliente y recibe sus alertas." };
  });
}

export async function archiveClientAction(id: string, _prev: ActionState): Promise<ActionState> {
  return guarded(async () => {
    await requireManageClient(id);
    await clients.archiveClient(id);
    revalidateAdmin();
    redirect("/admin/clientes");
  });
}

export async function createProjectAction(clientId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return guarded(async () => {
    await requireClientAccess(clientId);
    const client = await clients.getClient(clientId);
    const project = await projects.createProject(clientId, {
      name: field(fd, "name"),
      baseUrl: field(fd, "baseUrl"),
      phase: field(fd, "phase") || "development",
      auditFrequency: field(fd, "auditFrequency") || "weekly",
      sitemapUrl: field(fd, "sitemapUrl"),
    });
    revalidateAdmin();
    redirect(projectPath(client.slug, project.slug));
  });
}

/** El logotipo llega ya convertido a PNG y reducido por el navegador; aquí se vuelve a validar por firma, tamaño y proporción. */
export async function uploadClientLogoAction(id: string, kind: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return guarded(async () => {
    await requireClientAccess(id);
    if (!isLogoKind(kind)) throw new DomainError("INVALID", "Tipo de logotipo no válido.");
    const file = fd.get("logo");
    if (!(file instanceof File) || file.size === 0) throw new DomainError("INVALID", "Elige una imagen.");
    await clientLogo.setClientLogo(id, kind, new Uint8Array(await file.arrayBuffer()));
    revalidateAdmin();
    return { ok: "Logotipo guardado." };
  });
}

export async function removeClientLogoAction(id: string, kind: string, _prev: ActionState): Promise<ActionState> {
  return guarded(async () => {
    await requireClientAccess(id);
    if (!isLogoKind(kind)) throw new DomainError("INVALID", "Tipo de logotipo no válido.");
    await clientLogo.removeClientLogo(id, kind);
    revalidateAdmin();
    return { ok: "Logotipo quitado." };
  });
}

export async function setClientLogoBgAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return guarded(async () => {
    await requireClientAccess(id);
    await clientLogo.setClientLogoBg(id, field(fd, "bg"));
    revalidateAdmin();
    return { ok: "Color de fondo guardado." };
  });
}

/** Comparte el cliente entero con las personas marcadas y deja de compartirlo con las demás. Solo el propietario o el responsable. */
export async function saveClientSharesAction(clientId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return guarded(async () => {
    const session = await requireManageClient(clientId);
    const sharing = await getClientSharing(session, clientId);
    const chosen = new Set(fd.getAll("member").map(String));
    for (const m of sharing?.candidates ?? []) await setClientShare(session, clientId, m.id, chosen.has(m.id));
    revalidateAdmin();
    return { ok: "Guardado. Los cambios valen desde su siguiente carga del panel." };
  });
}

/** Comparte un proyecto suelto con las personas marcadas. Solo el propietario o el responsable de su cliente. */
export async function saveProjectSharesAction(projectId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return guarded(async () => {
    const session = await requireManageProject(projectId);
    const sharing = await getProjectSharing(session, projectId);
    const chosen = new Set(fd.getAll("member").map(String));
    for (const m of sharing?.candidates ?? []) await setProjectShare(session, projectId, m.id, chosen.has(m.id));
    revalidateAdmin();
    return { ok: "Guardado." };
  });
}
