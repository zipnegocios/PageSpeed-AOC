import { randomBytes } from "node:crypto";
import { getDb, type Database } from "@/server/db/client";
import { LOGO_PREFIX, assertLogo, parseLogoBg, type LogoKind } from "@/server/domain/client-logo";
import { DomainError } from "@/server/domain/errors";
import * as repo from "@/server/repositories/clients";
import { getR2, type R2Store } from "@/server/storage/r2";
import { assertUuid } from "./shared";

export type LogoDeps = { r2?: Pick<R2Store, "putObject" | "getObject" | "deleteObjects"> };

const deleteQuietly = async (keys: Array<string | null>, deps: LogoDeps) => {
  const list = keys.filter((k): k is string => Boolean(k));
  // Un objeto huérfano no debe romper lo demás.
  if (list.length > 0) await (deps.r2 ?? getR2()).deleteObjects(list).catch(() => undefined);
};

/** Valida el PNG, lo guarda en R2 bajo `_logos/<cliente>/` y borra el anterior del mismo tipo. */
export async function setClientLogo(clientId: string, kind: LogoKind, bytes: Uint8Array, db: Database = getDb(), deps: LogoDeps = {}): Promise<void> {
  assertUuid(clientId, "Cliente");
  assertLogo(bytes, kind);
  const key = `${LOGO_PREFIX}${clientId}/${kind}-${randomBytes(10).toString("hex")}.png`;
  await (deps.r2 ?? getR2()).putObject(key, Buffer.from(bytes), "image/png");
  const saved = await repo.setClientLogoKey(db, clientId, kind, key);
  if (!saved) {
    await deleteQuietly([key], deps);
    throw new DomainError("NOT_FOUND", "Cliente no encontrado.");
  }
  if (saved.previous && saved.previous !== key) await deleteQuietly([saved.previous], deps);
}

export async function removeClientLogo(clientId: string, kind: LogoKind, db: Database = getDb(), deps: LogoDeps = {}): Promise<void> {
  assertUuid(clientId, "Cliente");
  const saved = await repo.setClientLogoKey(db, clientId, kind, null);
  if (!saved) throw new DomainError("NOT_FOUND", "Cliente no encontrado.");
  await deleteQuietly([saved.previous], deps);
}

/** Color de fondo del logotipo (para logotipos blancos o claros). Vacío lo quita. */
export async function setClientLogoBg(clientId: string, raw: string, db: Database = getDb()): Promise<void> {
  assertUuid(clientId, "Cliente");
  const ok = await repo.setClientLogoBg(db, clientId, parseLogoBg(raw));
  if (!ok) throw new DomainError("NOT_FOUND", "Cliente no encontrado.");
}

export type StoredLogo = { bytes: Buffer; contentType: "image/png" };

/** El PNG de un logotipo, o null si el cliente no lo tiene o el objeto ya no está en R2 (los objetos no se respaldan). */
export async function readClientLogo(clientId: string, kind: LogoKind, db: Database = getDb(), deps: LogoDeps = {}): Promise<StoredLogo | null> {
  assertUuid(clientId, "Cliente");
  const client = await repo.findClient(db, clientId);
  const key = kind === "icon" ? client?.logoIconKey : client?.logoFullKey;
  if (!key) return null;
  try {
    return { bytes: await (deps.r2 ?? getR2()).getObject(key), contentType: "image/png" };
  } catch {
    return null;
  }
}

/** Lo necesario para dibujar el icono de la app de un cliente por su enlace: su isotipo (o, a falta, su logotipo completo) y el fondo. */
export async function readPwaIconSource(slug: string, db: Database = getDb(), deps: LogoDeps = {}): Promise<{ bytes: Buffer; bg: string | null } | null> {
  const client = await repo.findClientBySlug(db, slug);
  if (!client || client.status === "suspended") return null;
  const logo = (await readClientLogo(client.id, "icon", db, deps)) ?? (await readClientLogo(client.id, "full", db, deps));
  return logo ? { bytes: logo.bytes, bg: client.logoBg } : null;
}
