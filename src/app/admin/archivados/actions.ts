"use server";

import { revalidatePath } from "next/cache";
import { field, guarded, type ActionState } from "@/lib/actions";
import { verifySession } from "@/lib/auth/session";
import * as archive from "@/server/services/archive";

const refresh = () => {
  revalidatePath("/admin/archivados");
  revalidatePath("/admin/clientes");
  revalidatePath("/admin");
};

export async function restoreClientAction(id: string, _prev: ActionState): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    await archive.restoreClient(id);
    refresh();
    return { ok: "Cliente restaurado. Ya aparece en Clientes." };
  });
}

export async function restoreProjectAction(id: string, _prev: ActionState): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    await archive.restoreProject(id);
    refresh();
    return { ok: "Proyecto restaurado. Ya aparece en su cliente." };
  });
}

export async function deleteClientAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    const { files } = await archive.deleteClient(id, field(fd, "confirm"));
    refresh();
    return { ok: `Cliente eliminado para siempre (${files} informes borrados del almacenamiento).` };
  });
}

export async function deleteProjectAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    const { files } = await archive.deleteProject(id, field(fd, "confirm"));
    refresh();
    return { ok: `Proyecto eliminado para siempre (${files} informes borrados del almacenamiento).` };
  });
}
