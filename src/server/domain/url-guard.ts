import { lookup as dnsLookup } from "node:dns";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { DomainError } from "./errors";

// ------------------------------------------------------------------ direcciones IP

function ipv4ToNumber(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return null;
    n = n * 256 + Number(p);
  }
  return n;
}

// [inicio, máscara en bits] de rangos privados, reservados o de documentación.
const PRIVATE_V4: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function isPrivateV4(ip: string): boolean {
  const n = ipv4ToNumber(ip);
  if (n === null) return true; // formato raro: se trata como no seguro
  return PRIVATE_V4.some(([base, bits]) => {
    const start = ipv4ToNumber(base)!;
    const size = 2 ** (32 - bits);
    return n >= start && n < start + size;
  });
}

function expandV6(ip: string): number[] | null {
  let value = ip.split("%")[0]!;
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  if (v4) {
    const n = ipv4ToNumber(v4[1]!);
    if (n === null) return null;
    value = value.slice(0, -v4[1]!.length) + ((n >>> 16) & 0xffff).toString(16) + ":" + (n & 0xffff).toString(16);
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN));
  return nums.some(Number.isNaN) ? null : nums;
}

function v4FromGroups(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

function isPrivateV6(ip: string): boolean {
  const g = expandV6(ip);
  if (!g) return true;
  const [a, b, c, d, e, f, h, i] = g as [number, number, number, number, number, number, number, number];
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && i === 1) return true; // ::1
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0xffff) return isPrivateV4(v4FromGroups(h, i)); // ::ffff:a.b.c.d
  if (a === 0x64 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0) return isPrivateV4(v4FromGroups(h, i)); // NAT64
  if (a === 0x2002) return isPrivateV4(v4FromGroups(b, c)); // 6to4
  if ((a & 0xfe00) === 0xfc00) return true; // fc00::/7 (únicas locales)
  if ((a & 0xffc0) === 0xfe80) return true; // fe80::/10 (enlace local)
  if ((a & 0xffc0) === 0xfec0) return true; // fec0::/10 (obsoleta)
  if ((a & 0xff00) === 0xff00) return true; // multicast
  if (a === 0x2001 && b === 0x0db8) return true; // documentación
  return false;
}

/** true si la IP es privada, de loopback, enlace local, reservada, multicast o no reconocible. */
export function isPrivateAddress(ip: string): boolean {
  const clean = ip.replace(/^\[|\]$/g, "");
  const kind = isIP(clean);
  if (kind === 4) return isPrivateV4(clean);
  if (kind === 6) return isPrivateV6(clean);
  return true;
}

// ------------------------------------------------------------------ URLs y hosts

export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

/** Interpreta una URL http(s) sin credenciales incrustadas. */
export function parseHttpUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new DomainError("INVALID", "La URL no es válida. Incluye http:// o https://.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new DomainError("INVALID", "Solo se admiten direcciones http o https.");
  }
  if (url.username || url.password) {
    throw new DomainError("INVALID", "La URL no puede incluir usuario ni contraseña.");
  }
  return url;
}

/** Coincidencia exacta de host, o "*.dominio.com" para subdominios (no incluye el apex). */
export function isHostAllowed(host: string, allowedHosts: string[]): boolean {
  const h = normalizeHost(host);
  return allowedHosts.some((entry) => {
    const a = normalizeHost(entry);
    if (a.startsWith("*.")) return h.endsWith(a.slice(1)) && h.length > a.length - 1;
    return h === a;
  });
}

export function assertHostAllowed(url: URL, allowedHosts: string[]): void {
  if (!isHostAllowed(url.hostname, allowedHosts)) {
    throw new DomainError(
      "FORBIDDEN_HOST",
      `El host ${normalizeHost(url.hostname)} no está en los hosts permitidos del proyecto.`,
    );
  }
}

// ------------------------------------------------------------------ fetch seguro

type LookupCallback = (err: Error | null, address?: unknown, family?: number) => void;

/**
 * Resolución DNS que valida las direcciones en el momento de conectar (evita DNS rebinding:
 * un host que primero resuelve a una IP pública y luego a una privada).
 */
function guardedLookup(allowPrivate: boolean) {
  return (hostname: string, options: { all?: boolean } & Record<string, unknown>, callback: LookupCallback) => {
    dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err);
      const list = addresses as unknown as Array<{ address: string; family: number }>;
      if (list.length === 0) return callback(new Error("ADDRESS_NOT_ALLOWED"));
      if (!allowPrivate && list.some((a) => isPrivateAddress(a.address))) {
        return callback(new Error("ADDRESS_NOT_ALLOWED"));
      }
      if (options.all) return callback(null, list);
      callback(null, list[0]!.address, list[0]!.family);
    });
  };
}

const agents = new Map<boolean, Agent>();
function agentFor(allowPrivate: boolean): Agent {
  let agent = agents.get(allowPrivate);
  if (!agent) {
    agent = new Agent({ connect: { lookup: guardedLookup(allowPrivate) as never } });
    agents.set(allowPrivate, agent);
  }
  return agent;
}

export type GuardedFetchOptions = {
  allowedHosts: string[];
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  accept?: string;
  /** Solo para pruebas: permite conectar a direcciones privadas. Nunca en producción. */
  allowPrivate?: boolean;
};

export type GuardedResponse = { status: number; finalUrl: string; contentType: string; text: string };

/**
 * GET con salvaguardas anti-SSRF: solo http(s), host dentro de la lista permitida en cada salto
 * de redirección, sin IPs privadas, con límite de tiempo, de tamaño y de redirecciones.
 */
export async function fetchGuarded(rawUrl: string, opts: GuardedFetchOptions): Promise<GuardedResponse> {
  const { allowedHosts, timeoutMs = 8000, maxBytes = 5_000_000, maxRedirects = 3, allowPrivate = false } = opts;
  let url = parseHttpUrl(rawUrl);

  for (let hop = 0; ; hop++) {
    assertHostAllowed(url, allowedHosts);
    const host = normalizeHost(url.hostname);
    if (isIP(host) && !allowPrivate && isPrivateAddress(host)) {
      throw new DomainError("FORBIDDEN_HOST", "No se permite conectar a direcciones privadas o reservadas.");
    }

    let response;
    try {
      response = await undiciFetch(url, {
        redirect: "manual",
        dispatcher: agentFor(allowPrivate),
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "user-agent": "AOC-PageSpeed/1.0", accept: opts.accept ?? "*/*" },
      });
    } catch (err) {
      throw translateFetchError(err, host);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location) throw new DomainError("UPSTREAM", "El sitio respondió una redirección sin destino.");
      if (hop >= maxRedirects) throw new DomainError("UPSTREAM", "Demasiadas redirecciones.");
      try {
        url = parseHttpUrl(new URL(location, url).toString());
      } catch (err) {
        if (err instanceof DomainError) throw err;
        throw new DomainError("UPSTREAM", "El sitio redirige a una dirección no válida.");
      }
      continue;
    }

    const text = await readCapped(response.body, maxBytes);
    return {
      status: response.status,
      finalUrl: url.toString(),
      contentType: response.headers.get("content-type") ?? "",
      text,
    };
  }
}

async function readCapped(body: AsyncIterable<Uint8Array> | null, maxBytes: number): Promise<string> {
  if (!body) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.byteLength;
    // Salir del bucle cierra el iterador y cancela la descarga.
    if (total > maxBytes) throw new DomainError("UPSTREAM", "La respuesta es demasiado grande.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function translateFetchError(err: unknown, host: string): DomainError {
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  const text = `${e?.message ?? ""} ${e?.cause?.message ?? ""}`;
  if (text.includes("ADDRESS_NOT_ALLOWED")) {
    return new DomainError("FORBIDDEN_HOST", `${host} resuelve a una dirección privada o reservada.`);
  }
  if (e?.name === "TimeoutError" || e?.name === "AbortError") {
    return new DomainError("UPSTREAM", `${host} no respondió a tiempo.`);
  }
  const code = e?.cause?.code;
  if (code === "ENOTFOUND") return new DomainError("UPSTREAM", `No se encontró el host ${host}.`);
  if (code === "ECONNREFUSED") return new DomainError("UPSTREAM", `${host} rechazó la conexión.`);
  return new DomainError("UPSTREAM", `No se pudo conectar con ${host}.`);
}
