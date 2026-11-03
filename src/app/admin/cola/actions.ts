"use server";

import { revalidatePath } from "next/cache";
import { guarded, type ActionState } from "@/lib/actions";
import { verifySession } from "@/lib/auth/session";
import { requestBackupNow } from "@/server/services/backups";

export async function requestBackupAction(_prev: ActionState): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    const { queued } = await requestBackupNow();
    revalidatePath("/admin/cola");
    return { ok: queued ? "Respaldo pedido al worker. Aparecerá en la lista en unos segundos." : "Ya hay un respaldo en curso o esperando al worker." };
  });
}
