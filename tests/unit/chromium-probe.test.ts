import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeChromium, probeChromium, type ChromiumProbe } from "@/worker/lighthouse/chromium-probe";
import { withNote } from "@/server/domain/error-classifier";

const CHROME = [process.env.CHROME_PATH, "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome"].find((p) => p && existsSync(p));

describe("descripción de la prueba con Chromium", () => {
  const v = (id: string, label: string) => ({ id, label, flags: [], pin: true }) as never;
  const probe = (attempts: Array<[string, string, number | null, string?]>): ChromiumProbe => ({
    attempts: attempts.map(([id, label, status, excerpt]) => ({ variant: v(id, label), status, server: null, excerpt: excerpt ?? "" })),
    winner: null,
  });
  it("cuenta lo que recibió Chromium y cada variante", () => {
    const text = describeChromium(probe([["base", "Chromium", 403, "Access denied"], ["unpinned", "sin fijar IP", 403], ["stealth", "sin señales de automatización", 200], ["http1", "HTTP/1.1", null]]));
    expect(text).toBe("Navegador: Chromium 403 «Access denied» · sin fijar IP 403 · sin señales de automatización 200 · HTTP/1.1 sin respuesta.");
    expect(describeChromium(null)).toBe("");
  });
  it("el mensaje admite una nota larga hasta el tope indicado", () => {
    const f = { code: "HTTP_4XX", retryable: false, message: "La página respondió con error 403." };
    expect(withNote(f, "x".repeat(900), 600).message.length).toBe(600);
    expect(withNote(f, "x".repeat(900)).message.length).toBe(300);
  });
});

describe.skipIf(!CHROME)("prueba con Chromium real", () => {
  let server: Server;
  let port = 0;
  beforeAll(async () => {
    // Rechaza al navegador cuando no declara español: solo la variante con --lang=es-ES pasa.
    server = createServer((req, res) => {
      const ok = String(req.headers["accept-language"] ?? "").toLowerCase().startsWith("es");
      res.writeHead(ok ? 200 : 403, { "content-type": "text/html", server: "prueba" });
      res.end(ok ? "<title>Bienvenido</title><p>hola</p>" : "<title>Acceso denegado</title><p>Tu navegador no es bienvenido</p>");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("registra lo que recibió Chromium y encuentra la variante que abre la puerta", async () => {
    const p = await probeChromium(`http://127.0.0.1:${port}/`, undefined, { chromePath: CHROME });
    expect(p).not.toBeNull();
    const byId = Object.fromEntries(p!.attempts.map((a) => [a.variant.id, a]));
    expect(byId.base).toMatchObject({ status: 403, server: "prueba" });
    expect(byId.base!.excerpt).toContain("Acceso denegado");
    expect(byId.stealth!.status).toBe(200);
    expect(p!.winner?.id).toBe("stealth");
    expect(describeChromium(p)).toMatch(/^Navegador: Chromium 403 «Acceso denegado/);
  }, 120_000);

  it("si Chromium ya pasa sin cambios, no prueba más variantes", async () => {
    const ok = createServer((_q, res) => void res.writeHead(200, { "content-type": "text/html" }).end("<title>Hola</title>"));
    await new Promise<void>((r) => ok.listen(0, "127.0.0.1", r));
    const p = await probeChromium(`http://127.0.0.1:${(ok.address() as AddressInfo).port}/`, undefined, { chromePath: CHROME });
    await new Promise<void>((r) => ok.close(() => r()));
    expect(p!.attempts).toHaveLength(1);
    expect(p!.winner?.id).toBe("base");
  }, 60_000);

  it("si Chromium no arranca, no lanza: devuelve «sin respuesta»", async () => {
    const p = await probeChromium("http://127.0.0.1:1/", undefined, { chromePath: "/no/existe" });
    expect(p!.winner).toBeNull();
    expect(p!.attempts[0]!.status).toBeNull();
  }, 30_000);
});
