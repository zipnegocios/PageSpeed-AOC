"use server";

import { revalidatePath } from "next/cache";
import { field, guarded, type ActionState } from "@/lib/actions";
import { requireOwner, requireProjectAccess } from "@/lib/auth/access";
import { clearGoogleAccount, removeConnection, saveConnection, saveGoogleAccount, testConnection } from "@/server/services/seo-connections";
import { addMarket, removeMarket } from "@/server/services/seo-markets";
import { setSeoClientVisible } from "@/server/services/seo-portal";
import { requestCrawl } from "@/server/services/seo-crawl";
import { requestSeoSync } from "@/server/services/seo-sync";

/** Las direcciones llevan slugs de cliente y proyecto: se revalida todo el panel en lugar de adivinar cada ruta. */
const refresh = () => revalidatePath("/admin", "layout");

export async function saveGoogleAccountAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return guarded(async () => {
    await requireOwner();
    const { email } = await saveGoogleAccount(field(fd, "serviceAccount"));
    refresh();
    return { ok: `Cuenta conectada: ${email}. Ahora agrega ese correo en el Search Console y el GA4 de cada cliente.` };
  });
}

export async function clearGoogleAccountAction(_prev: ActionState): Promise<ActionState> {
  return guarded(async () => {
    await requireOwner();
    await clearGoogleAccount();
    refresh();
    return { ok: "Cuenta de servicio quitada." };
  });
}

export async function saveConnectionAction(projectId: string, kind: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return guarded(async () => {
    await requireProjectAccess(projectId);
    // Cada tarjeta de la página usa identificadores propios (gsc_externalId, ga4_externalId…) para que las etiquetas no se confundan.
    await saveConnection(projectId, kind, { externalId: field(fd, `${kind}_externalId`), token: field(fd, `${kind}_token`) });
    refresh();
    return { ok: "Guardado. Pulsa «Probar conexión» para comprobar que funciona." };
  });
}

export async function testConnectionAction(projectId: string, kind: string, _prev: ActionState): Promise<ActionState> {
  return guarded(async () => {
    await requireProjectAccess(projectId);
    const result = await testConnection(projectId, kind);
    refresh();
    return result.ok ? { ok: result.detail } : { error: result.detail };
  });
}

export async function removeConnectionAction(projectId: string, kind: string, _prev: ActionState): Promise<ActionState> {
  return guarded(async () => {
    await requireProjectAccess(projectId);
    await removeConnection(projectId, kind);
    refresh();
    return { ok: "Conexión quitada." };
  });
}

/** «Actualizar ahora»: pide al worker descargar los datos de Search Console y GA4 de este proyecto. */
export async function requestSeoSyncAction(projectId: string, _prev: ActionState): Promise<ActionState> {
  return guarded(async () => {
    await requireProjectAccess(projectId);
    const { queued } = await requestSeoSync(projectId);
    refresh();
    return { ok: queued ? "Actualización pedida. El worker descarga los datos de Google en unos minutos; recarga la página para verlos." : "Ya hay una actualización pendiente para este proyecto." };
  });
}

/** Declara un idioma del sitio. Los campos llevan prefijo `market_` para no chocar con otros formularios de la página. */
export async function addMarketAction(projectId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return guarded(async () => {
    await requireProjectAccess(projectId);
    const market = await addMarket(projectId, { lang: field(fd, "market_lang"), prefix: field(fd, "market_prefix"), isDefault: fd.get("market_default") === "on" });
    refresh();
    return { ok: `${market.label} agregado${market.isDefault ? " como idioma por defecto" : ` con el prefijo ${market.prefix}`}.` };
  });
}

export async function removeMarketAction(projectId: string, lang: string, _prev: ActionState): Promise<ActionState> {
  return guarded(async () => {
    await requireProjectAccess(projectId);
    await removeMarket(projectId, lang);
    refresh();
    return { ok: "Idioma quitado." };
  });
}

/** Muestra u oculta «Tráfico y búsqueda» en el portal del cliente de este proyecto. */
export async function setSeoClientVisibleAction(projectId: string, visible: boolean, _prev: ActionState): Promise<ActionState> {
  return guarded(async () => {
    await requireProjectAccess(projectId);
    await setSeoClientVisible(projectId, visible);
    refresh();
    return { ok: visible ? "Listo: el cliente ya ve «Tráfico y búsqueda» en su portal." : "Listo: el cliente ya no ve «Tráfico y búsqueda» en su portal." };
  });
}

/** «Rastrear ahora»: pide al worker auditar el sitio del proyecto. Sirve también para proyectos en desarrollo. */
export async function requestCrawlAction(projectId: string, _prev: ActionState): Promise<ActionState> {
  return guarded(async () => {
    await requireProjectAccess(projectId);
    const { queued } = await requestCrawl(projectId);
    refresh();
    return { ok: queued ? "Rastreo pedido. El worker recorre el sitio en unos minutos; recarga la página para ver el resultado." : "Ya hay un rastreo en cola o en curso para este proyecto." };
  });
}
