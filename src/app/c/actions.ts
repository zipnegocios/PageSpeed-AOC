"use server";

import { redirect } from "next/navigation";
import { field, guarded, type ActionState } from "@/lib/actions";
import { clientIp } from "@/lib/auth/client-ip";
import { pinIpSlugLimiter, pinRequestLimiter, pinSlugLimiter } from "@/lib/auth/pin-limiters";
import { setPortalSession } from "@/lib/auth/portal-session";
import { isPin } from "@/server/domain/portal-pin";
import { isValidSlug } from "@/server/domain/slug";
import { requestPinByEmail, verifyClientPin } from "@/server/services/portal-pin";

const TOO_MANY = "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.";

/** El cliente escribe su PIN en el portal. Con el correcto se abre una sesión de 30 días en este navegador. */
export async function verifyPinAction(slug: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  return guarded(async () => {
    if (!isValidSlug(slug)) return { error: "PIN incorrecto." };
    const ip = await clientIp();
    const ipKey = `${ip}|${slug}`;
    if (pinIpSlugLimiter.isBlocked(ipKey) || pinSlugLimiter.isBlocked(slug)) return { error: TOO_MANY };
    const pin = field(fd, "pin").trim();
    const result = isPin(pin) ? await verifyClientPin(slug, pin) : ({ ok: false } as const);
    if (!result.ok) {
      // Un PIN mal escrito también cuenta: no se distingue "formato malo" de "PIN equivocado".
      pinIpSlugLimiter.recordFailure(ipKey);
      pinSlugLimiter.recordFailure(slug);
      return { error: isPin(pin) ? "PIN incorrecto." : "El PIN tiene 6 dígitos." };
    }
    pinIpSlugLimiter.reset(ipKey);
    await setPortalSession(result.client);
    redirect(`/c/${slug}`);
  });
}

/** El cliente pide un PIN nuevo a su correo. La respuesta es la misma exista o no el cliente o su correo. */
export async function requestPinAction(slug: string, _prev: ActionState): Promise<ActionState> {
  return guarded(async () => {
    const ip = await clientIp();
    if (pinRequestLimiter.isBlocked(ip)) return { error: TOO_MANY };
    pinRequestLimiter.recordFailure(ip); // cada petición cuenta, salga bien o no
    if (isValidSlug(slug)) await requestPinByEmail(slug);
    return { ok: "Si hay un correo registrado, enviamos un PIN nuevo. Revisa tu bandeja (y el correo no deseado)." };
  });
}
