import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import pino from "pino";
import type { Job } from "bullmq";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fixture from "../fixtures/lhr-minimal.json";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import * as s from "@/server/db/schema";
import { isDomainError } from "@/server/domain/errors";
import * as clients from "@/server/services/clients";
import { clearProjectAuth, getProjectAuthSummary, resolveProjectAuth, setProjectAuth } from "@/server/services/project-auth";
import * as projects from "@/server/services/projects";
import * as routes from "@/server/services/routes";
import { createAuditProcessor } from "@/worker/processors/audit.processor";
import type { LighthouseRunner, RunnerInput } from "@/worker/lighthouse/runner";

const dbUrl = process.env.TEST_DATABASE_URL;
const KEY = randomBytes(32).toString("base64");
const OTHER = randomBytes(32).toString("base64");

describe.skipIf(!dbUrl)("acceso a páginas privadas", () => {
  const { db, pool } = createDb(dbUrl ?? "", 4);
  beforeAll(async () => { await runMigrations(dbUrl!, "./drizzle"); });
  afterAll(() => pool.end());
  beforeEach(async () => { await db.execute(sql`truncate clients, settings restart identity cascade`); });

  async function setup(requiresAuth = true) {
    const client = await clients.createClient({ name: "Acme" }, db);
    const project = await projects.createProject(client.id, { name: "Panel", baseUrl: "https://acme.test", allowedHosts: undefined }, db);
    await db.update(s.projects).set({ allowedHosts: ["acme.test", "login.acme.test"] }).where(eq(s.projects.id, project.id));
    const route = await routes.addRoute(project.id, { path: "/cuenta", requiresAuth }, db);
    return { client, project, route };
  }
  const form = { strategy: "form" as const, loginUrl: "/login", username: "ana@acme.test", password: "contraseña-ultra-secreta" };

  describe("guardado", () => {
    it("guarda cifrado, devuelve solo lo seguro y no deja nada legible en la base", async () => {
      const { project } = await setup();
      const out = await setProjectAuth(project.id, form, db, { key: KEY });
      expect(out).toEqual({ configured: true, strategy: "form", loginUrl: "https://acme.test/login", username: "ana@acme.test" });
      const [row] = await db.select().from(s.projects).where(eq(s.projects.id, project.id));
      expect(row!.authStrategy).toBe("script");
      expect(row!.authConfigEnc!.toString("latin1")).not.toMatch(/ultra-secreta|ana@acme/);
      expect(JSON.stringify(await getProjectAuthSummary(project.id, db, { key: KEY }))).not.toContain("ultra-secreta");
      expect(resolveProjectAuth(row!, KEY)).toMatchObject({ strategy: "form", password: "contraseña-ultra-secreta", loginUrl: "https://acme.test/login" });
    });

    it("cookies: guarda los pares y el resumen solo muestra los nombres", async () => {
      const { project } = await setup();
      const out = await setProjectAuth(project.id, { strategy: "cookie", cookies: "sid=VALOR-SECRETO; theme=dark" }, db, { key: KEY });
      expect(out).toEqual({ configured: true, strategy: "cookie", cookieNames: ["sid", "theme"] });
      const [row] = await db.select().from(s.projects).where(eq(s.projects.id, project.id));
      expect(row!.authStrategy).toBe("cookie");
      expect(row!.authConfigEnc!.toString("latin1")).not.toContain("SECRETO");
      expect(JSON.stringify(await getProjectAuthSummary(project.id, db, { key: KEY }))).not.toContain("SECRETO");
    });

    it("reemplaza la configuración anterior y se puede quitar", async () => {
      const { project } = await setup();
      await setProjectAuth(project.id, { strategy: "cookie", cookies: "a=1" }, db, { key: KEY });
      await setProjectAuth(project.id, form, db, { key: KEY });
      expect((await getProjectAuthSummary(project.id, db, { key: KEY })).configured && (await getProjectAuthSummary(project.id, db, { key: KEY }))).toMatchObject({ strategy: "form" });
      await clearProjectAuth(project.id, db);
      expect(await getProjectAuthSummary(project.id, db, { key: KEY })).toEqual({ configured: false });
      const [row] = await db.select().from(s.projects).where(eq(s.projects.id, project.id));
      expect(row).toMatchObject({ authStrategy: "none", authConfigEnc: null });
    });

    it("la página de login debe estar en un host permitido; un subdominio permitido sí vale", async () => {
      const { project } = await setup();
      const evil = await setProjectAuth(project.id, { ...form, loginUrl: "https://evil.test/login" }, db, { key: KEY }).catch((e) => e);
      expect(isDomainError(evil) && evil.code).toBe("FORBIDDEN_HOST");
      const sub = await setProjectAuth(project.id, { ...form, loginUrl: "https://login.acme.test/entrar#x" }, db, { key: KEY });
      expect(sub).toMatchObject({ loginUrl: "https://login.acme.test/entrar" });
      const bad = await setProjectAuth(project.id, { ...form, loginUrl: "ftp://acme.test/x" }, db, { key: KEY }).catch((e) => e);
      expect(isDomainError(bad)).toBe(true);
    });

    it("exige la clave de cifrado y explica cómo crearla", async () => {
      const { project } = await setup();
      const none = await setProjectAuth(project.id, form, db, { key: "" }).catch((e) => e);
      expect(String(none.message)).toContain("AUTH_ENCRYPTION_KEY");
      const bad = await setProjectAuth(project.id, form, db, { key: "corta" }).catch((e) => e);
      expect(String(bad.message)).toContain("32 bytes");
      expect((await getProjectAuthSummary(project.id, db, { key: KEY })).configured).toBe(false);
    });

    it("valida los datos de formulario y las cookies", async () => {
      const { project } = await setup();
      for (const bad of [
        { ...form, username: "" },
        { ...form, password: "" },
        { strategy: "cookie" as const, cookies: "" },
        { strategy: "cookie" as const, cookies: "sin-formato" },
      ]) {
        expect(isDomainError(await setProjectAuth(project.id, bad, db, { key: KEY }).catch((e) => e))).toBe(true);
      }
    });

    it("con otra clave el resumen dice que no se puede leer, sin fallar", async () => {
      const { project } = await setup();
      await setProjectAuth(project.id, form, db, { key: KEY });
      expect(await getProjectAuthSummary(project.id, db, { key: OTHER })).toEqual({ configured: true, strategy: "form", unreadable: true });
    });
  });

  describe("el worker usa el acceso", () => {
    const log = pino({ level: "silent" });
    const resolver = async () => [{ address: "93.184.216.34", family: 4 }];

    async function run(opts: { authKey?: string; withAuth?: boolean; requiresAuth?: boolean; configure?: (projectId: string) => Promise<void> }) {
      const { project, route } = await setup(opts.requiresAuth ?? true);
      if (opts.configure) await opts.configure(project.id);
      else if (opts.withAuth !== false) await setProjectAuth(project.id, form, db, { key: KEY });
      const [audit] = await db.insert(s.auditLogs).values({ projectId: project.id, routeId: route.id, profile: "mobile", trigger: "manual", phaseAtRun: "development" }).returning();
      let received: RunnerInput | undefined;
      const runner: LighthouseRunner = async (input) => { received = input; return { lhr: structuredClone(fixture) as never }; };
      const process = createAuditProcessor({
        db, r2: { putAuditJson: async () => ({ bytes: 1 }) }, runner, log, timeoutMs: 1000, cooldownMs: 0, sleep: async () => {},
        resolver, authKey: opts.authKey ?? KEY,
      });
      const job = { id: audit!.id, data: { auditId: audit!.id }, attemptsMade: 0, opts: { attempts: 3 } } as unknown as Job<{ auditId: string }>;
      const outcome = await process(job as never).then(() => "ok", (e: Error) => e.message);
      const [after] = await db.select().from(s.auditLogs).where(eq(s.auditLogs.id, audit!.id));
      return { received, after: after!, outcome };
    }

    it("una ruta privada llega al runner con el acceso descifrado y los hosts permitidos", async () => {
      const { received, after } = await run({});
      expect(after.status).toBe("succeeded");
      expect(received?.auth?.config).toMatchObject({ strategy: "form", username: "ana@acme.test", password: "contraseña-ultra-secreta" });
      expect(received?.auth?.allowedHosts).toEqual(["acme.test", "login.acme.test"]);
      expect(received?.pinnedHost).toEqual({ host: "acme.test", ip: "93.184.216.34" });
    });

    it("si el login está en otro host permitido, también se valida y se fija su IP", async () => {
      const { received } = await run({
        configure: async (id) => void (await setProjectAuth(id, { ...form, loginUrl: "https://login.acme.test/entrar" }, db, { key: KEY })),
      });
      expect(received?.extraPinnedHosts).toEqual([{ host: "login.acme.test", ip: "93.184.216.34" }]);
    });

    it("una ruta pública no recibe credenciales aunque el proyecto las tenga", async () => {
      const { received, after } = await run({ requiresAuth: false });
      expect(after.status).toBe("succeeded");
      expect(received?.auth).toBeUndefined();
    });

    it("ruta privada sin acceso configurado falla de inmediato y sin reintentos", async () => {
      const { after, outcome, received } = await run({ withAuth: false });
      expect(received).toBeUndefined();
      expect(after).toMatchObject({ status: "failed", errorCode: "AUTH_NOT_CONFIGURED", attempts: 1 });
      expect(outcome).toContain("acceso configurado");
    });

    it("con una clave distinta a la usada al guardar falla con AUTH_CONFIG, sin detallar y sin reintentos", async () => {
      const { after, received } = await run({ authKey: OTHER });
      expect(received).toBeUndefined();
      expect(after).toMatchObject({ status: "failed", errorCode: "AUTH_CONFIG" });
      expect(after.errorMessage).toContain("AUTH_ENCRYPTION_KEY");
    });

    it("sin clave en el worker también es AUTH_CONFIG", async () => {
      const { after } = await run({ authKey: "" });
      expect(after).toMatchObject({ status: "failed", errorCode: "AUTH_CONFIG" });
    });
  });
});
