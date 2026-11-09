"use server";

import { revalidatePath } from "next/cache";
import { field, guarded, type ActionState } from "@/lib/actions";
import { verifySession } from "@/lib/auth/session";
import { clearGoogleAccount, removeConnection, saveConnection, saveGoogleAccount, testConnection } from "@/server/services/seo-connections";
import { requestSeoSync } from "@/server/services/seo-sync";

/** Las direcciones llevan slugs de cliente y proyecto: se revalida todo el panel en lugar de adivinar cada ruta. */
const refresh = () => revalidatePath("/admin", "layout");

export async function saveGoogleAccountAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    const { email } = await saveGoogleAccount(field(fd, "serviceAccount"));
    refresh();
    return { ok: `Cuenta conectada: ${email}. Ahora agrega ese correo en el Search Console y el GA4 de cada cliente.` };
  });
}

export async function clearGoogleAccountAction(_prev: ActionState): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    await clearGoogleAccount();
    refresh();
    return { ok: "Cuenta de servicio quitada." };
  });
}

export async function saveConnectionAction(projectId: string, kind: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    // Cada tarjeta de la página usa identificadores propios (gsc_externalId, ga4_externalId…) para que las etiquetas no se confundan.
    await saveConnection(projectId, kind, { externalId: field(fd, `${kind}_externalId`), token: field(fd, `${kind}_token`) });
    refresh();
    return { ok: "Guardado. Pulsa «Probar conexión» para comprobar que funciona." };
  });
}

export async function testConnectionAction(projectId: string, kind: string, _prev: ActionState): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    const result = await testConnection(projectId, kind);
    refresh();
    return result.ok ? { ok: result.detail } : { error: result.detail };
  });
}

export async function removeConnectionAction(projectId: string, kind: string, _prev: ActionState): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    await removeConnection(projectId, kind);
    refresh();
    return { ok: "Conexión quitada." };
  });
}

/** «Actualizar ahora»: pide al worker descargar los datos de Search Console y GA4 de este proyecto. */
export async function requestSeoSyncAction(projectId: string, _prev: ActionState): Promise<ActionState> {
  await verifySession();
  return guarded(async () => {
    const { queued } = await requestSeoSync(projectId);
    refresh();
    return { ok: queued ? "Actualización pedida. El worker descarga los datos de Google en unos minutos; recarga la página para verlos." : "Ya hay una actualización pendiente para este proyecto." };
  });
}
