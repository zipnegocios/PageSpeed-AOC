"use server";

import { revalidatePath } from "next/cache";
import { field, guarded, type ActionState } from "@/lib/actions";
import { verifySession } from "@/lib/auth/session";
import { createApiKey, revokeApiKey } from "@/server/services/api-keys";

export async function createApiKeyAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    const { key, view } = await createApiKey({ name: field(fd, "name"), preset: field(fd, "preset") });
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
