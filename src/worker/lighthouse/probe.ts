import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isPrivateAddress, normalizeHost } from "@/server/domain/url-guard";
import type { HostResolver } from "../host-pin";
import type { PinnedHost } from "./runner";

/**
 * Diagnóstico de un 4xx de Lighthouse: tres peticiones GET sencillas a la misma dirección, hechas desde el worker, para ver **quién** rechaza.
 * Chromium con la IP fijada y el agente de Lighthouse es lo que falló; aquí se separa cada factor:
 *  - `pinned`: la IP fijada, con el agente de Lighthouse (lo que hizo Chromium),
 *  - `dns`: el DNS normal, con el mismo agente (si pasa y `pinned` no, la culpa es la IP fijada),
 *  - `browser`: el DNS normal y un agente de navegador corriente (si pasa y `dns` no, el sitio rechaza «Chrome-Lighthouse»).
 * Si las tres dan lo mismo, el sitio rechaza la IP del worker o la ruta no existe. Nunca lanza; nunca consulta direcciones privadas.
 */
export type ProbeResult = { status: number | null; server: string | null };
export type Probe = { pinned: ProbeResult | null; dns: ProbeResult; browser: ProbeResult };

const LIGHTHOUSE_UA: Record<"mobile" | "desktop", string> = {
  mobile: "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse",
  desktop: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 Chrome-Lighthouse",
};
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

const MAX_REDIRECTS = 4;
const defaultResolver: HostResolver = (host) => dnsLookup(host, { all: true });

type Options = { allowPrivate?: boolean; resolver?: HostResolver; timeoutMs?: number };

/** Una petición GET que sigue redirecciones a mano; en cada salto se vuelve a validar la dirección. */
function get(url: URL, ua: string, pin: PinnedHost | undefined, opts: Required<Pick<Options, "timeoutMs">> & Options, hops = 0): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const host = normalizeHost(url.hostname);
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    const done = (r: ProbeResult) => resolve(r);
    const req = request(
      url,
      {
        method: "GET",
        // Sin reutilizar conexiones: la prueba con IP fijada y la de DNS normal comparten nombre y puerto, y no deben compartir socket.
        agent: false,
        headers: { "user-agent": ua, accept: "text/html,*/*;q=0.8" },
        timeout: opts.timeoutMs,
        // La IP se resuelve aquí para poder rechazar las privadas (y fijar la de Chromium cuando se pide).
        lookup: (name: string, o: { all?: boolean }, cb: (...args: unknown[]) => void) => {
          // Node pide a veces una lista (`all`) y a veces una sola dirección.
          const reply = (address: string, family: number) => (o?.all ? cb(null, [{ address, family }]) : cb(null, address, family));
          if (isIP(host)) {
            if (!opts.allowPrivate && isPrivateAddress(host)) return cb(Object.assign(new Error("dirección no permitida"), { code: "EBLOCKED" }));
            return reply(host.replace(/^\[|\]$/g, ""), isIP(host));
          }
          if (pin && normalizeHost(name) === pin.host) return reply(pin.ip, pin.ip.includes(":") ? 6 : 4);
          (opts.resolver ?? defaultResolver)(host).then(
            (addrs) => {
              const allowed = addrs.filter((a) => opts.allowPrivate || !isPrivateAddress(a.address));
              const chosen = allowed.find((a) => a.family === 4) ?? allowed[0];
              if (!chosen) return cb(Object.assign(new Error("dirección no permitida"), { code: "EBLOCKED" }));
              reply(chosen.address, chosen.family);
            },
            (err: Error) => cb(err),
          );
        },
      } as never,
      (res: IncomingMessage) => {
        res.resume();
        const status = res.statusCode ?? null;
        const server = typeof res.headers.server === "string" ? res.headers.server.slice(0, 40) : null;
        const location = res.headers.location;
        if (status && status >= 300 && status < 400 && location && hops < MAX_REDIRECTS) {
          try {
            const next = new URL(location, url);
            if (next.protocol === "http:" || next.protocol === "https:") return void get(next, ua, pin, opts, hops + 1).then(done);
          } catch {
            /* destino ilegible: se informa el 3xx */
          }
        }
        done({ status, server });
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => done({ status: null, server: null }));
    req.end();
  });
}

export async function probeSite(url: string, profile: "mobile" | "desktop", pin: PinnedHost | undefined, options: Options = {}): Promise<Probe | null> {
  try {
    const target = new URL(url);
    const opts = { ...options, timeoutMs: options.timeoutMs ?? 8000 };
    const [pinned, dns, browser] = await Promise.all([
      pin ? get(target, LIGHTHOUSE_UA[profile], pin, opts) : Promise.resolve(null),
      get(target, LIGHTHOUSE_UA[profile], undefined, opts),
      get(target, BROWSER_UA, undefined, opts),
    ]);
    return { pinned, dns, browser };
  } catch {
    return null;
  }
}

const ok = (r: ProbeResult | null) => r !== null && r.status !== null && r.status < 400;
const show = (r: ProbeResult | null) => (r === null ? "—" : r.status === null ? "sin respuesta" : String(r.status));

/** La IP fijada es la culpable: con ella falla y con el DNS normal pasa. */
export const pinIsCulprit = (p: Probe | null): boolean => p !== null && p.pinned !== null && !ok(p.pinned) && ok(p.dns);

/** Una línea para el mensaje de la auditoría fallida. */
export function describeProbe(p: Probe | null): string {
  if (!p) return "";
  const parts = [p.pinned ? `IP fijada ${show(p.pinned)}` : null, `DNS normal ${show(p.dns)}`, `otro agente ${show(p.browser)}`].filter(Boolean).join(" · ");
  const server = p.dns.server ?? p.browser.server;
  return `Prueba desde el worker: ${parts}${server ? ` (servidor: ${server})` : ""}.`;
}
