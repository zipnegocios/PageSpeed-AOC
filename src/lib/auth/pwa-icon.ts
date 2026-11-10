import "server-only";
import { signPwaIcon, verifyPwaIcon } from "@/server/auth/pwa-icon-sig";

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET no está definida o tiene menos de 32 caracteres");
  return value;
}

/** Dirección firmada de un icono de la app (`size` en píxeles) para el enlace `token` del portal. */
export function pwaIconUrl(token: string, size: number, v: number): string {
  return `/c/${token}/pwa-icon/${size}?v=${v}&s=${signPwaIcon(secret(), token, String(v))}`;
}

export const isValidPwaIcon = (token: string, v: string, given: string) => verifyPwaIcon(secret(), token, v, given);
