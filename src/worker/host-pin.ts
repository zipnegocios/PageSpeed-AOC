import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { DomainError } from "@/server/domain/errors";
import { isPrivateAddress, normalizeHost } from "@/server/domain/url-guard";
import type { PinnedHost } from "./lighthouse/runner";

export type HostResolver = (host: string) => Promise<Array<{ address: string; family: number }>>;

const defaultResolver: HostResolver = (host) => lookup(host, { all: true });

/**
 * Resuelve el host a auditar y rechaza direcciones privadas. Devuelve la IP validada para fijarla
 * en Chromium (evita que el navegador resuelva por su cuenta a otra dirección).
 * Si el host ya es una IP, no hay nada que fijar.
 */
export async function resolvePinnedHost(
  url: string,
  options: { allowPrivate?: boolean; resolver?: HostResolver } = {},
): Promise<PinnedHost | undefined> {
  const host = normalizeHost(new URL(url).hostname);
  if (isIP(host)) {
    if (!options.allowPrivate && isPrivateAddress(host)) {
      throw new DomainError("FORBIDDEN_HOST", "No se permite auditar direcciones privadas o reservadas.");
    }
    return undefined;
  }
  let addresses;
  try {
    addresses = await (options.resolver ?? defaultResolver)(host);
  } catch {
    throw new DomainError("UPSTREAM", `No se encontró el host ${host}.`);
  }
  if (addresses.length === 0) throw new DomainError("UPSTREAM", `No se encontró el host ${host}.`);
  if (!options.allowPrivate && addresses.some((a) => isPrivateAddress(a.address))) {
    throw new DomainError("FORBIDDEN_HOST", `${host} resuelve a una dirección privada o reservada.`);
  }
  const chosen = addresses.find((a) => a.family === 4) ?? addresses[0]!;
  return { host, ip: chosen.address };
}
