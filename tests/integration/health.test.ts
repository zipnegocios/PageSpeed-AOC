import { createServer, type Server } from "node:http";
import { createServer as createTcp, type Server as TcpServer } from "node:net";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkDependencies, checkPostgres, checkR2, checkRedis, checkSmtp, isLive, runChecks } from "@/server/services/health";

const dbUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;

function listenHttp(handler: Parameters<typeof createServer>[1]): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }));
  });
}

describe.skipIf(!dbUrl)("salud: Postgres", () => {
  beforeAll(() => {
    process.env.DATABASE_URL = dbUrl;
  });
  it("responde cuando la base está disponible", async () => {
    await expect(checkPostgres()).resolves.toBeUndefined();
    expect(await isLive()).toBe(true);
  });
});

describe.skipIf(!redisUrl)("salud: Redis", () => {
  it("acepta la contraseña correcta", async () => {
    await expect(checkRedis(redisUrl!)).resolves.toBeUndefined();
  });
  it("detecta una contraseña incorrecta como AUTH", async () => {
    const bad = redisUrl!.replace(/:[^:@/]*@/, ":incorrecta@");
    const [r] = await runChecks({ redis: () => checkRedis(bad) });
    expect(r).toMatchObject({ ok: false, error: "AUTH" });
  });
  it("detecta un Redis inalcanzable", async () => {
    const [r] = await runChecks({ redis: () => checkRedis("redis://127.0.0.1:1") });
    expect(r?.ok).toBe(false);
    expect(r?.error).toBe("ECONNREFUSED");
  });
});

describe("salud: R2 (servidor S3 simulado)", () => {
  let fake: { server: Server; url: string };
  beforeAll(async () => {
    fake = await listenHttp((req, res) => {
      const bucket = (req.url ?? "").split("/")[1]?.split("?")[0];
      res.statusCode = bucket === "reportes" ? 200 : bucket === "prohibido" ? 403 : 404;
      res.end();
    });
  });
  afterAll(() => fake.server.close());
  const cfg = (bucket: string) => ({ endpoint: fake.url, region: "auto", bucket, accessKeyId: "ak", secretAccessKey: "sk" });

  it("comprueba que el bucket existe", async () => {
    await expect(checkR2(cfg("reportes"))).resolves.toBeUndefined();
  });
  it("distingue permiso denegado y bucket inexistente", async () => {
    const results = await runChecks({ r2: () => checkR2(cfg("prohibido")) });
    expect(results[0]).toMatchObject({ ok: false });
    expect(results[0]?.error).toMatch(/403|Forbidden/);
    const missing = await runChecks({ r2: () => checkR2(cfg("noexiste")) });
    expect(missing[0]?.error).toMatch(/404|NotFound/);
  });
});

describe("salud: SMTP (servidor simulado)", () => {
  let tcp: TcpServer;
  let port: number;
  beforeAll(async () => {
    tcp = createTcp((socket) => {
      socket.write("220 fake ESMTP\r\n");
      let buf = "";
      socket.on("data", (d) => {
        buf += d.toString();
        let i: number;
        while ((i = buf.indexOf("\r\n")) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (/^(EHLO|HELO)/.test(line)) socket.write("250-fake\r\n250 AUTH PLAIN\r\n");
          else if (line.startsWith("AUTH PLAIN")) {
            const decoded = Buffer.from(line.split(" ")[2] ?? "", "base64").toString();
            socket.write(decoded === "\0usuario\0clave-buena" ? "235 ok\r\n" : "535 5.7.8 credenciales invalidas\r\n");
          } else if (line === "QUIT") {
            socket.write("221 bye\r\n");
            socket.end();
          } else socket.write("250 ok\r\n");
        }
      });
    });
    await new Promise<void>((r) => tcp.listen(0, "127.0.0.1", r));
    port = (tcp.address() as AddressInfo).port;
  });
  afterAll(() => tcp.close());

  it("acepta credenciales correctas", async () => {
    await expect(checkSmtp({ host: "127.0.0.1", port, user: "usuario", pass: "clave-buena" })).resolves.toBeUndefined();
  });
  it("rechaza credenciales incorrectas sin filtrar la respuesta del servidor", async () => {
    const [r] = await runChecks({ smtp: () => checkSmtp({ host: "127.0.0.1", port, user: "usuario", pass: "mala" }) });
    expect(r).toMatchObject({ ok: false });
    expect(JSON.stringify(r)).not.toContain("credenciales invalidas");
  });
});

describe("checkDependencies", () => {
  it("con entorno incompleto informa qué variables faltan, solo por nombre", async () => {
    const report = await checkDependencies({ DATABASE_URL: "", SESSION_SECRET: "x" });
    expect(report.status).toBe("degraded");
    expect(report.invalidEnv).toEqual(expect.arrayContaining(["DATABASE_URL", "REDIS_URL", "R2_BUCKET"]));
    expect(report.checks).toEqual([]);
  });
});
