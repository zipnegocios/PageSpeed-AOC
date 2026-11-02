import { execSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuditTimeoutError } from "@/server/domain/audit-errors";
import { extractResults } from "@/server/domain/score-extraction";
import { runLighthouse } from "@/worker/lighthouse/runner";

// Prueba opt-in con Chromium y Lighthouse REALES. Uso:
//   TEST_CHROME_PATH=/ruta/a/chrome pnpm exec vitest run --dangerouslyIgnoreUnhandledErrors \
//     tests/integration/lighthouse-real.test.ts
// El indicador es necesario porque, al cerrar Chromium a la fuerza (prueba del plazo vencido),
// Lighthouse deja un rechazo interno que el worker real registra con un manejador propio.
const chromePath = process.env.TEST_CHROME_PATH;

const PAGE = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prueba</title><meta name="description" content="Página de prueba"></head><body><h1>Hola</h1><p>Contenido.</p></body></html>`;

const chromeProcesses = () => {
  try {
    return Number(execSync("pgrep -fc 'aoc-chrome[-]' || true").toString().trim()) || 0;
  } catch {
    return 0;
  }
};

describe.skipIf(!chromePath)("Lighthouse real (Chromium del sistema)", () => {
  let server: Server;
  let origin: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/colgada") return; // nunca responde
      res.writeHead(200, { "content-type": "text/html" }).end(PAGE);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  it.each(["mobile", "desktop"] as const)("audita en perfil %s y devuelve puntuaciones válidas", async (profile) => {
    const { lhr } = await runLighthouse({ url: `${origin}/`, profile, timeoutMs: 90_000, chromePath });
    const r = extractResults(lhr);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const score of [r.metrics.scorePerformance, r.metrics.scoreSeo, r.metrics.scoreAccessibility, r.metrics.scoreBestPractices]) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
    expect(r.metrics.lcpMs).toBeGreaterThan(0);
    expect(r.metrics.httpStatus).toBe(200);
    expect(r.metrics.inpMs).toBeNull();
    expect((lhr as { configSettings?: { formFactor?: string } }).configSettings?.formFactor).toBe(profile);
    expect(chromeProcesses()).toBe(0); // no quedan navegadores huérfanos
  }, 120_000);

  it("fija la IP del host: resuelve un nombre falso a través de --host-resolver-rules", async () => {
    const port = new URL(origin).port;
    const { lhr } = await runLighthouse({
      url: `http://pinned.invalid:${port}/`,
      profile: "mobile",
      timeoutMs: 90_000,
      chromePath,
      pinnedHost: { host: "pinned.invalid", ip: "127.0.0.1" },
    });
    expect(extractResults(lhr).ok).toBe(true);
  }, 120_000);

  it("corta una página colgada al vencer el plazo y no deja Chromium vivo", async () => {
    const started = Date.now();
    await expect(runLighthouse({ url: `${origin}/colgada`, profile: "mobile", timeoutMs: 8_000, chromePath })).rejects.toBeInstanceOf(AuditTimeoutError);
    expect(Date.now() - started).toBeLessThan(20_000);
    await new Promise((r) => setTimeout(r, 1500));
    expect(chromeProcesses()).toBe(0);
  }, 60_000);

  it("informa un Chromium inexistente como error de Chromium", async () => {
    await expect(
      runLighthouse({ url: `${origin}/`, profile: "mobile", timeoutMs: 10_000, chromePath: "/ruta/que/no/existe/chrome" }),
    ).rejects.toMatchObject({ name: "ChromeError" });
  }, 30_000);
});
