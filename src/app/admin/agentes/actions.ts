"use server";

import { revalidatePath } from "next/cache";
import { field, guarded, type ActionState } from "@/lib/actions";
import { verifySession } from "@/lib/auth/session";
import { createApiKey, deleteApiKey, revokeApiKey, rotateApiKey, updateApiKey } from "@/server/services/api-keys";

/** Los campos del formulario de una clave (los mismos al crear y al editar). */
function keyFields(fd: FormData) {
  return {
    name: field(fd, "name"),
    preset: field(fd, "preset"),
    access: field(fd, "access"),
    clientIds: fd.getAll("clientIds").map(String),
    projectIds: fd.getAll("projectIds").map(String),
  };
}

export async function createApiKeyAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    const { key, view } = await createApiKey(keyFields(fd));
    revalidatePath("/admin/agentes");
    return { ok: `Clave «${view.name}» creada.`, secret: key };
  });
}

export async function revokeApiKeyAction(id: string, _prev: ActionState): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    await revokeApiKey(id);
    revalidatePath("/admin/agentes");
    return { ok: "Clave revocada. El agente que la usaba ya no puede conectarse." };
  });
}

export async function updateApiKeyAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    const view = await updateApiKey(id, keyFields(fd));
    revalidatePath("/admin/agentes");
    return { ok: `Cambios guardados en «${view.name}». Valen desde la siguiente llamada del agente.` };
  });
}

export async function rotateApiKeyAction(id: string, _prev: ActionState): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    const { key, view } = await rotateApiKey(id);
    revalidatePath("/admin/agentes");
    return { ok: `Clave de «${view.name}» rotada. La anterior ya no funciona. Copia la nueva ahora: no se vuelve a mostrar.`, secret: key };
  });
}

export async function deleteApiKeyAction(id: string, _prev: ActionState): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    await deleteApiKey(id);
    revalidatePath("/admin/agentes");
    return { ok: "Clave eliminada." };
  });
}
