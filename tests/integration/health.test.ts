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

// No depende del Redis del entorno: algunos (como el de la CI) no tienen contraseña.
describe("salud: Redis con contraseña incorrecta (servidor simulado)", () => {
  let fake: TcpServer;
  let port: number;
  beforeAll(async () => {
    // ioredis envía varios comandos juntos (HELLO … AUTH y CLIENT SETINFO) y espera una respuesta
    // por cada uno, como Redis: se rechaza el login y se exige autenticación al resto.
    fake = createTcp((socket) => {
      socket.on("data", (data) => {
        for (const command of data.toString().split(/(?=\*\d+\r\n\$)/)) {
          const name = /^\*\d+\r\n\$\d+\r\n(\w+)\r\n/.exec(command)?.[1]?.toLowerCase();
          if (!name) continue;
          socket.write(
            name === "hello" || name === "auth"
              ? "-WRONGPASS invalid username-password pair or user is disabled.\r\n"
              : "-NOAUTH Authentication required.\r\n",
          );
        }
      });
    });
    await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
    port = (fake.address() as AddressInfo).port;
  });
  afterAll(() => fake.close());

  it("se informa como AUTH, sin filtrar la contraseña ni el mensaje del servidor", async () => {
    const [r] = await runChecks({ redis: () => checkRedis(`redis://default:clave-secreta@127.0.0.1:${port}`) });
    expect(r).toMatchObject({ name: "redis", ok: false, error: "AUTH" });
    expect(JSON.stringify(r)).not.toContain("clave-secreta");
    expect(JSON.stringify(r)).not.toContain("WRONGPASS");
  });
});

describe.skipIf(!redisUrl)("salud: Redis", () => {
  it("acepta la contraseña correcta", async () => {
    await expect(checkRedis(redisUrl!)).resolves.toBeUndefined();
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

describe.skipIf(!dbUrl || !redisUrl)("checkDependencies con entorno parcial", () => {
  it("comprueba lo que puede y nombra las variables que faltan", async () => {
    process.env.DATABASE_URL = dbUrl;
    const report = await checkDependencies({ DATABASE_URL: dbUrl, REDIS_URL: redisUrl });
    expect(report.status).toBe("degraded");
    expect(report.checks.map((c) => c.name).sort()).toEqual(["postgres", "redis", "worker"]);
    expect(report.checks.find((c) => c.name === "postgres")?.ok).toBe(true);
    expect(report.checks.find((c) => c.name === "redis")?.ok).toBe(true);
    expect(report.invalidEnv).toEqual(expect.arrayContaining(["R2_BUCKET", "SMTP_HOST", "SESSION_SECRET"]));
    expect(JSON.stringify(report)).not.toContain(redisUrl!);
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
