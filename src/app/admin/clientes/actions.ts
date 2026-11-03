"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { field, guarded, type ActionState } from "@/lib/actions";
import { verifySession } from "@/lib/auth/session";
import { clientPath, projectPath } from "@/lib/urls";
import * as clients from "@/server/services/clients";
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
  await verifySession();
  return guarded(async () => {
    const client = await clients.createClient({ ...contact(fd), slug: field(fd, "slug") });
    revalidatePath("/admin/clientes");
    redirect(clientPath(client.slug));
  });
}

export async function updateClientAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
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
  await verifySession();
  return guarded(async () => {
    await clients.setClientStatus(id, status);
    revalidateAdmin();
    return { ok: status === "suspended" ? "Cliente suspendido." : "Cliente activado." };
  });
}

export async function renameClientSlugAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    const client = await clients.renameClientSlug(id, field(fd, "slug"));
    revalidateAdmin();
    // La dirección actual cambió: se abre la nueva.
    redirect(clientPath(client.slug));
  });
}

export async function rotateMagicTokenAction(id: string, _prev: ActionState): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    await clients.rotateMagicToken(id);
    revalidateAdmin();
    return { ok: "Se generó un link nuevo. El anterior ya no funciona." };
  });
}

export async function archiveClientAction(id: string, _prev: ActionState): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    await clients.archiveClient(id);
    revalidateAdmin();
    redirect("/admin/clientes");
  });
}

export async function createProjectAction(clientId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
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
