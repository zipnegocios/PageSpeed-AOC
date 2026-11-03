import { execSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthFailedError } from "@/server/domain/audit-errors";
import { extractResults } from "@/server/domain/score-extraction";
import { runLighthouse, type RunnerInput } from "@/worker/lighthouse/runner";

// Prueba opt-in con Chromium y Lighthouse REALES contra un sitio local con inicio de sesión:
//   TEST_CHROME_PATH=/ruta/a/chrome pnpm exec vitest run --dangerouslyIgnoreUnhandledErrors \
//     tests/integration/lighthouse-auth-real.test.ts
const chromePath = process.env.TEST_CHROME_PATH;

const html = (title: string, body: string) =>
  `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><meta name="description" content="Prueba"></head><body>${body}</body></html>`;
const LOGIN = (error = "") =>
  html("Entrar", `<main><h1>Entrar</h1>${error}<form method="post" action="/login"><label for="u">Usuario</label><input id="u" name="usuario" type="text"><label for="p">Contraseña</label><input id="p" name="clave" type="password"><button type="submit">Entrar</button></form></main>`);

const chromeProcesses = () => {
  try {
    return Number(execSync("pgrep -fc 'aoc-chrome[-]' || true").toString().trim()) || 0;
  } catch {
    return 0;
  }
};

describe.skipIf(!chromePath)("Lighthouse real con inicio de sesión", () => {
  let server: Server;
  let origin: string;
  let host: string;
  const hits: string[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = req.url ?? "/";
      hits.push(`${req.method} ${url}`);
      const logged = /(?:^|;\s*)sid=ok123(?:;|$)/.test(req.headers.cookie ?? "");
      if (url === "/login" && req.method === "GET") return void res.writeHead(200, { "content-type": "text/html" }).end(LOGIN());
      if (url === "/login" && req.method === "POST") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          const p = new URLSearchParams(body);
          if (p.get("usuario") === "ana" && p.get("clave") === "secreta") {
            res.writeHead(302, { "set-cookie": "sid=ok123; Path=/; HttpOnly", location: "/privado" }).end();
          } else {
            res.writeHead(200, { "content-type": "text/html" }).end(LOGIN('<p role="alert">Datos incorrectos</p>'));
          }
        });
        return;
      }
      if (url === "/privado") {
        if (!logged) return void res.writeHead(302, { location: "/login" }).end();
        return void res.writeHead(200, { "content-type": "text/html" }).end(html("Panel privado", "<main><h1>Panel privado</h1><p>Solo con sesión.</p></main>"));
      }
      if (url === "/login-ajeno") {
        const other = `http://localhost:${(server.address() as AddressInfo).port}/login`;
        return void res.writeHead(302, { location: other }).end();
      }
      res.writeHead(404).end("no");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    origin = `http://127.0.0.1:${port}`;
    host = "127.0.0.1";
  });
  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  const base = (): Omit<RunnerInput, "auth"> => ({ url: `${origin}/privado`, profile: "mobile", timeoutMs: 90_000, chromePath });
  const form = (over: Record<string, string> = {}) => ({
    config: { strategy: "form" as const, loginUrl: `${origin}/login`, username: "ana", password: "secreta", ...over },
    allowedHosts: [host],
  });

  it("formulario: inicia sesión y mide la página privada, no la de login", async () => {
    const { lhr } = await runLighthouse({ ...base(), auth: form() });
    const r = extractResults(lhr);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.metrics.httpStatus).toBe(200);
    expect(r.metrics.finalUrl).toBe(`${origin}/privado`);
    expect((lhr as { audits?: Record<string, { details?: unknown }> }).audits).toBeDefined();
    expect(hits).toContain("POST /login");
    expect(chromeProcesses()).toBe(0);
  }, 120_000);

  it("formulario: con selectores explícitos también entra", async () => {
    const { lhr } = await runLighthouse({
      ...base(),
      auth: form({ usernameSelector: "#u", passwordSelector: "#p", submitSelector: "button[type=submit]", successSelector: "" }),
    });
    expect(extractResults(lhr).ok).toBe(true);
  }, 120_000);

  it("contraseña incorrecta: AUTH_FAILED y el mensaje no incluye credenciales", async () => {
    const err = await runLighthouse({ ...base(), auth: form({ password: "equivocada" }) }).catch((e) => e);
    expect(err).toBeInstanceOf(AuthFailedError);
    expect(err.authCode).toBe("AUTH_FAILED");
    expect(err.message).not.toMatch(/equivocada|ana|secreta/);
    expect(chromeProcesses()).toBe(0);
  }, 120_000);

  it("campo de contraseña inexistente: AUTH_FAILED claro", async () => {
    const err = await runLighthouse({ ...base(), auth: form({ passwordSelector: "#no-existe" }) }).catch((e) => e);
    expect(err).toBeInstanceOf(AuthFailedError);
    expect(err.message).toContain("campo de contraseña");
  }, 120_000);

  it("cookie válida: mide la página privada", async () => {
    const { lhr } = await runLighthouse({ ...base(), auth: { config: { strategy: "cookie", cookies: [{ name: "sid", value: "ok123" }] }, allowedHosts: [host] } });
    const r = extractResults(lhr);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.metrics.finalUrl).toBe(`${origin}/privado`);
  }, 120_000);

  it("cookie caducada o inválida: la página lleva al login y se informa como AUTH_FAILED", async () => {
    const err = await runLighthouse({ ...base(), auth: { config: { strategy: "cookie", cookies: [{ name: "sid", value: "caducada" }] }, allowedHosts: [host] } }).catch((e) => e);
    expect(err).toBeInstanceOf(AuthFailedError);
    expect(err.message).toMatch(/sesión/);
    expect(err.message).not.toContain("caducada");
  }, 120_000);

  it("un login que redirige a un host no permitido no recibe las credenciales", async () => {
    const before = hits.length;
    const err = await runLighthouse({ ...base(), auth: form({ loginUrl: `${origin}/login-ajeno` }) }).catch((e) => e);
    expect(err).toBeInstanceOf(AuthFailedError);
    expect(err.message).toContain("host");
    // El servidor "ajeno" (localhost) se visitó, pero nunca se envió el formulario.
    expect(hits.slice(before).some((h) => h.startsWith("POST"))).toBe(false);
  }, 120_000);
});
