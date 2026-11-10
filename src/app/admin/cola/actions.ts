"use server";

import { revalidatePath } from "next/cache";
import { guarded, type ActionState } from "@/lib/actions";
import { requireOwner } from "@/lib/auth/access";
import { requestBackupNow } from "@/server/services/backups";

export async function requestBackupAction(_prev: ActionState): Promise<ActionState> {
  return guarded(async () => {
    await requireOwner();
    const { queued } = await requestBackupNow();
    revalidatePath("/admin/cola");
    return { ok: queued ? "Respaldo pedido al worker. Aparecerá en la lista en unos segundos." : "Ya hay un respaldo en curso o esperando al worker." };
  });
}
