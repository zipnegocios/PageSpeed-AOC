import { getDb, type Database } from "@/server/db/client";
import { ccAddresses, greetingNames } from "@/server/domain/client-welcome";
import { DomainError } from "@/server/domain/errors";
import { generatePin, hashPin, isPin, pinMatches } from "@/server/domain/portal-pin";
import { isValidSlug } from "@/server/domain/slug";
import type { Mailer } from "@/server/notify/mailer";
import { buildPinEmail } from "@/server/notify/pin-email";
import { webMailer } from "@/server/notify/web-mailer";
import * as repo from "@/server/repositories/clients";
import type { Client } from "@/server/repositories/clients";
import { decryptJson, encryptJson } from "@/server/crypto/secret-box";
import { assertUuid } from "./shared";

/** Mínimo entre dos PIN pedidos por correo desde el portal: frena el correo no deseado y el cierre de sesiones ajenas. */
export const PIN_REQUEST_COOLDOWN_MS = 15 * 60_000;

export type PinDeps = {
  mailer?: Mailer;
  appUrl?: string;
  secret?: string;
  /** AUTH_ENCRYPTION_KEY: con ella el último PIN queda guardado (cifrado) para mostrarlo en el panel. */
  authKey?: string;
  now?: () => Date;
};

function secretOf(deps: PinDeps): string {
  const value = deps.secret ?? process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET no está definida o tiene menos de 32 caracteres");
  return value;
}

/** El PIN cifrado para guardarlo, o null si no hay clave válida (entonces el PIN funciona pero no se puede volver a mostrar). */
function sealPin(pin: string, deps: PinDeps): Buffer | null {
  try {
    return encryptJson(pin, deps.authKey ?? process.env.AUTH_ENCRYPTION_KEY);
  } catch {
    return null;
  }
}

/** El último PIN generado, o null si no se guardó (clave ausente, PIN anterior a esta función o dato ilegible). */
export function readStoredPin(client: { pinEnc: Buffer | null }, deps: PinDeps = {}): string | null {
  if (!client.pinEnc) return null;
  try {
    const pin = decryptJson<string>(client.pinEnc, deps.authKey ?? process.env.AUTH_ENCRYPTION_KEY);
    return isPin(pin) ? pin : null;
  } catch {
    return null;
  }
}

function baseUrl(deps: PinDeps): string {
  return (deps.appUrl ?? process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

async function sendPin(client: Client, pin: string, deps: PinDeps): Promise<void> {
  const to = client.contactEmail?.trim();
  if (!to) throw new DomainError("INVALID", "Este cliente no tiene correo de contacto. Agrégalo en su ficha para poder enviarle el PIN.");
  // El acceso es uno solo para todo el equipo: el PIN nuevo le llega al contacto principal y a quienes van en copia.
  const cc = ccAddresses(client.ccContacts, to);
  const mail = buildPinEmail({
    contactName: client.contactName,
    names: greetingNames(client.contactName, client.ccContacts),
    clientName: client.name,
    pin,
    portalUrl: `${baseUrl(deps)}/c/${client.slug}`,
  });
  try {
    await (deps.mailer ?? webMailer()).send({ to, ...(cc.length > 0 ? { cc } : {}), ...mail });
  } catch {
    throw new DomainError("UPSTREAM", "No se pudo enviar el correo. Revisa la configuración SMTP e inténtalo de nuevo.");
  }
}

/**
 * Desde el panel: genera un PIN nuevo (el anterior y las sesiones abiertas dejan de valer). El PIN en claro se devuelve
 * una sola vez; en la base de datos solo queda su huella. Con `email`, además se envía al correo del cliente.
 */
export async function generateClientPin(clientId: string, opts: { email?: boolean } = {}, db: Database = getDb(), deps: PinDeps = {}) {
  assertUuid(clientId, "Cliente");
  const client = await repo.findClient(db, clientId);
  if (!client) throw new DomainError("NOT_FOUND", "Cliente no encontrado.");
  const pin = generatePin();
  // Primero el correo: si falla, el PIN anterior sigue valiendo y no se deja al cliente sin acceso.
  if (opts.email) await sendPin(client, pin, deps);
  const now = (deps.now ?? (() => new Date()))();
  await repo.setClientPinRow(db, client.id, hashPin(client.id, pin, secretOf(deps)), now, sealPin(pin, deps));
  return { pin, emailed: Boolean(opts.email), to: opts.email ? (client.contactEmail ?? null) : null };
}

export type PinCheck = { ok: true; client: Client } | { ok: false };

/** Comprueba un PIN contra el cliente del enlace. Un cliente que no existe o sin PIN simplemente falla. */
export async function verifyClientPin(ref: string, pin: string, db: Database = getDb(), deps: PinDeps = {}): Promise<PinCheck> {
  const secret = secretOf(deps);
  const client = isValidSlug(ref) ? await repo.findClientBySlug(db, ref) : undefined;
  const given = isPin(pin) ? pin : "000000";
  // Siempre se calcula la huella, exista o no el cliente, para que el tiempo no delate nada.
  const matches = pinMatches(client?.pinHash, client?.id ?? "", given, secret);
  return client && matches && isPin(pin) ? { ok: true, client } : { ok: false };
}

/**
 * Lo pide el propio cliente desde el portal: un PIN nuevo al correo de su ficha. No revela si el cliente o el correo
 * existen (`sent: false` cubre todos los casos en silencio) y respeta un tiempo mínimo entre envíos.
 */
export async function requestPinByEmail(ref: string, db: Database = getDb(), deps: PinDeps = {}): Promise<{ sent: boolean }> {
  const secret = secretOf(deps);
  const now = (deps.now ?? (() => new Date()))();
  const client = isValidSlug(ref) ? await repo.findClientBySlug(db, ref) : undefined;
  if (!client || client.status === "suspended" || !client.contactEmail?.trim()) return { sent: false };
  const reserved = await repo.reservePinRequest(db, client.id, now, PIN_REQUEST_COOLDOWN_MS);
  if (!reserved) return { sent: false };
  const pin = generatePin();
  try {
    await sendPin(client, pin, deps);
  } catch (err) {
    await repo.restorePinRequest(db, client.id, reserved.previous);
    throw err;
  }
  await repo.setClientPinRow(db, client.id, hashPin(client.id, pin, secret), now, sealPin(pin, deps));
  return { sent: true };
}
