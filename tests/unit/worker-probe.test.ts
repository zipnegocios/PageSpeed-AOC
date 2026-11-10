import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { classifyError, withNote } from "@/server/domain/error-classifier";
import { LighthouseRuntimeError } from "@/server/domain/audit-errors";
import { describeProbe, pinIsCulprit, probeSite, type Probe } from "@/worker/lighthouse/probe";

describe("clasificación de los 4xx", () => {
  const f = (status: number) => classifyError(new LighthouseRuntimeError("ERRORED_DOCUMENT_REQUEST", `Status code: ${status}`));
  it("429, 408 y 425 se reintentan; 403, 404, 401 y 410 no", () => {
    for (const s of [429, 408, 425]) expect(f(s)).toMatchObject({ code: "HTTP_4XX", retryable: true });
    for (const s of [403, 404, 401, 410]) expect(f(s)).toMatchObject({ code: "HTTP_4XX", retryable: false });
  });
  it("withNote añade la prueba sin pasar de 300 caracteres", () => {
    const out = withNote(f(403), "Prueba desde el worker: IP fijada 403.");
    expect(out.message).toContain("La página respondió con error 403. Prueba desde el worker");
    expect(withNote(f(403), "x".repeat(500)).message.length).toBeLessThanOrEqual(300);
    expect(withNote(f(403), "")).toEqual(f(403));
  });
});

describe("diagnóstico de un 4xx desde el worker", () => {
  let server: Server;
  let port = 0;
  const seen: Array<{ ua: string; local: string }> = [];
  beforeAll(async () => {
    server = createServer((req, res) => {
      const ua = String(req.headers["user-agent"]);
      const local = req.socket.localAddress ?? "";
      seen.push({ ua, local });
      if (req.url === "/redir") {
        res.writeHead(302, { location: "/final" });
        return void res.end();
      }
      // 403 a la IP fijada (127.0.0.1) y al agente de Lighthouse; el resto pasa.
      const blocked = local.endsWith("127.0.0.1") && /Chrome-Lighthouse/.test(ua);
      res.writeHead(blocked ? 403 : 200, { server: "prueba" });
      res.end("ok");
    });
    await new Promise<void>((r) => server.listen(0, "0.0.0.0", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const resolver = async () => [{ address: "127.0.0.2", family: 4 }];

  it("separa IP fijada, DNS normal y agente: la culpable es la IP fijada", async () => {
    const p = await probeSite(`http://sitio.test:${port}/`, "mobile", { host: "sitio.test", ip: "127.0.0.1" }, { allowPrivate: true, resolver });
    expect(p).toMatchObject({ pinned: { status: 403 }, dns: { status: 200 }, browser: { status: 200 } });
    expect(pinIsCulprit(p)).toBe(true);
    expect(describeProbe(p)).toBe("Prueba desde el worker: IP fijada 403 · DNS normal 200 · otro agente 200 (servidor: prueba).");
  });

  it("si el DNS normal también falla, la IP fijada no es la culpable", async () => {
    const p = await probeSite(`http://sitio.test:${port}/`, "desktop", { host: "sitio.test", ip: "127.0.0.1" }, { allowPrivate: true, resolver: async () => [{ address: "127.0.0.1", family: 4 }] });
    expect(p).toMatchObject({ pinned: { status: 403 }, dns: { status: 403 }, browser: { status: 200 } });
    expect(pinIsCulprit(p)).toBe(false);
  });

  it("sin IP fijada solo hace dos pruebas y sigue redirecciones", async () => {
    const p = await probeSite(`http://sitio.test:${port}/redir`, "mobile", undefined, { allowPrivate: true, resolver });
    expect(p!.pinned).toBeNull();
    expect(p!.dns.status).toBe(200);
    expect(describeProbe(p)).not.toContain("IP fijada");
  });

  it("nunca consulta direcciones privadas cuando no están permitidas, ni siquiera tras una redirección", async () => {
    const before = seen.length;
    const p = await probeSite(`http://privado.test:${port}/`, "mobile", undefined, { allowPrivate: false, resolver });
    expect(p).toMatchObject({ dns: { status: null }, browser: { status: null } });
    expect(seen.length).toBe(before);
    expect(describeProbe(p)).toContain("DNS normal sin respuesta");
  });

  it("un servidor que no existe no lanza: informa «sin respuesta»", async () => {
    const p = await probeSite("http://127.0.0.1:1/", "mobile", undefined, { allowPrivate: true, timeoutMs: 1500 });
    expect(p!.dns.status).toBeNull();
  });
});

describe("pinIsCulprit", () => {
  const r = (status: number | null) => ({ status, server: null });
  it("requiere que falle la IP fijada y pase el DNS normal", () => {
    expect(pinIsCulprit({ pinned: r(403), dns: r(200), browser: r(200) } as Probe)).toBe(true);
    expect(pinIsCulprit({ pinned: r(200), dns: r(200), browser: r(200) } as Probe)).toBe(false);
    expect(pinIsCulprit({ pinned: null, dns: r(200), browser: r(200) } as Probe)).toBe(false);
    expect(pinIsCulprit(null)).toBe(false);
  });
});
