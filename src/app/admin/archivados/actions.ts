"use server";

import { revalidatePath } from "next/cache";
import { field, guarded, type ActionState } from "@/lib/actions";
import { requireManageArchivedClient, requireManageArchivedProject } from "@/lib/auth/access";
import * as archive from "@/server/services/archive";

const refresh = () => {
  revalidatePath("/admin/archivados");
  revalidatePath("/admin/clientes");
  revalidatePath("/admin");
};

export async function restoreClientAction(id: string, _prev: ActionState): Promise<ActionState> {
  return guarded(async () => {
    await requireManageArchivedClient(id);
    await archive.restoreClient(id);
    refresh();
    return { ok: "Cliente restaurado. Ya aparece en Clientes." };
  });
}

export async function restoreProjectAction(id: string, _prev: ActionState): Promise<ActionState> {
  return guarded(async () => {
    await requireManageArchivedProject(id);
    await archive.restoreProject(id);
    refresh();
    return { ok: "Proyecto restaurado. Ya aparece en su cliente." };
  });
}

export async function deleteClientAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return guarded(async () => {
    await requireManageArchivedClient(id);
    const { files } = await archive.deleteClient(id, field(fd, "confirm"));
    refresh();
    return { ok: `Cliente eliminado para siempre (${files} informes borrados del almacenamiento).` };
  });
}

export async function deleteProjectAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return guarded(async () => {
    await requireManageArchivedProject(id);
    const { files } = await archive.deleteProject(id, field(fd, "confirm"));
    refresh();
    return { ok: `Proyecto eliminado para siempre (${files} informes borrados del almacenamiento).` };
  });
}
