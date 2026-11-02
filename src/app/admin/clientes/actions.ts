"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { field, guarded, type ActionState } from "@/lib/actions";
import { verifySession } from "@/lib/auth/session";
import * as clients from "@/server/services/clients";
import * as projects from "@/server/services/projects";

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
    redirect(`/admin/clientes/${client.id}`);
  });
}

export async function updateClientAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    await clients.updateClient(id, contact(fd));
    revalidatePath(`/admin/clientes/${id}`);
    revalidatePath("/admin/clientes");
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
    revalidatePath(`/admin/clientes/${id}`);
    revalidatePath("/admin/clientes");
    return { ok: status === "suspended" ? "Cliente suspendido." : "Cliente activado." };
  });
}

export async function rotateMagicTokenAction(id: string, _prev: ActionState): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    await clients.rotateMagicToken(id);
    revalidatePath(`/admin/clientes/${id}`);
    return { ok: "Se generó un link nuevo. El anterior ya no funciona." };
  });
}

export async function archiveClientAction(id: string, _prev: ActionState): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    await clients.archiveClient(id);
    revalidatePath("/admin/clientes");
    redirect("/admin/clientes");
  });
}

export async function createProjectAction(clientId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    const project = await projects.createProject(clientId, {
      name: field(fd, "name"),
      baseUrl: field(fd, "baseUrl"),
      phase: field(fd, "phase") || "development",
      auditFrequency: field(fd, "auditFrequency") || "weekly",
      sitemapUrl: field(fd, "sitemapUrl"),
    });
    revalidatePath(`/admin/clientes/${clientId}`);
    redirect(`/admin/proyectos/${project.id}`);
  });
}
