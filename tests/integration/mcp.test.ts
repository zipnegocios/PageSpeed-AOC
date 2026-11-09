import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLimits, handleMcpRequest, type McpDeps } from "@/mcp/handler";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import * as s from "@/server/db/schema";
import { AttemptLimiter } from "@/server/auth/rate-limit";
import { createRedis } from "@/server/queue/connection";
import { writeHeartbeat } from "@/server/queue/heartbeat";
import { lighthouseQueue } from "@/server/queue/queues";
import * as alerts from "@/server/services/alerts";
import { createApiKey, deleteApiKey, revokeApiKey, rotateApiKey, updateApiKey } from "@/server/services/api-keys";
import * as clients from "@/server/services/clients";
import * as projects from "@/server/services/projects";
import * as routes from "@/server/services/routes";

const dbUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
const ready = Boolean(dbUrl && redisUrl);
const DAY = 86_400_000;
const URL_MCP = "https://app.test/api/mcp";

describe.skipIf(!ready)("servidor MCP", () => {
  const { db, pool } = createDb(dbUrl ?? "", 4);
  const redis = createRedis(redisUrl ?? "redis://localhost:6379");
  const queue = lighthouseQueue(redis);
  const opened: Client[] = [];
  let deps: McpDeps;
  let sleeps: Array<() => Promise<void>> = [];

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: dbUrl, REDIS_URL: redisUrl, SESSION_SECRET: "x".repeat(40), R2_ENDPOINT: "http://127.0.0.1:9",
      R2_BUCKET: "reportes", R2_ACCESS_KEY_ID: "a", R2_SECRET_ACCESS_KEY: "b", SMTP_HOST: "localhost", EMAIL_FROM: "x@x.test",
    });
    await runMigrations(dbUrl!, "./drizzle");
  });
  afterAll(async () => {
    await Promise.all(opened.map((c) => c.close().catch(() => undefined)));
    await redis.del("aoc:worker:heartbeat"); // no dejar un worker "en línea" para las demás pruebas
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
    await redis.quit();
    await pool.end();
  });
  beforeEach(async () => {
    await queue.obliterate({ force: true });
    await db.execute(sql`truncate clients, settings, mcp_api_keys restart identity cascade`);
    await writeHeartbeat(redis, { chrome: true });
    sleeps = [];
    deps = {
      appOrigin: "https://app.test",
      ip: "9.9.9.9",
      limits: createLimits(),
      context: { sleep: async () => { for (const f of sleeps) await f(); } },
    };
  });

  const fetchVia = (key: string | null, d: () => McpDeps) => ((url: string | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (key) headers.set("Authorization", `Bearer ${key}`);
    return handleMcpRequest(new Request(url, { ...init, headers }), d());
  }) as typeof fetch;

  async function connect(preset: "read" | "audit" | "configure", scope: { clientIds?: string[]; projectIds?: string[] } = {}) {
    const selected = (scope.clientIds?.length ?? 0) + (scope.projectIds?.length ?? 0) > 0;
    const { key, view } = await createApiKey({ name: `agente-${preset}`, preset, access: selected ? "selected" : "all", ...scope }, db);
    const client = new Client({ name: "prueba", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(URL_MCP), { fetch: fetchVia(key, () => deps) }));
    opened.push(client);
    return { client, key, id: view.id };
  }
  const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
    const text = r.content[0]!.text;
    return { isError: Boolean(r.isError), text, json: r.isError ? null : JSON.parse(text) };
  };

  async function seed(phase: "development" | "production" = "production") {
    const client = await clients.createClient({ name: "Acme" }, db);
    const project = await projects.createProject(client.id, { name: "Tienda", baseUrl: "https://acme.test" }, db);
    if (phase === "production") await db.update(s.projects).set({ phase }).where(eq(s.projects.id, project.id));
    const home = await routes.addRoute(project.id, { path: "/" }, db);
    const audit = async (profile: "mobile" | "desktop", daysAgo: number, p: number, seo = 95) => {
      const when = new Date(Date.now() - daysAgo * DAY);
      const [row] = await db.insert(s.auditLogs).values({
        projectId: project.id, routeId: home.id, profile, trigger: "scheduled", phaseAtRun: "production", status: "succeeded",
        scorePerformance: p, scoreSeo: seo, scoreAccessibility: 100, scoreBestPractices: 100, lcpMs: 2100, tbtMs: 90, cls: "0.0100",
        r2Key: "k", queuedAt: when, finishedAt: when,
      }).returning();
      return row!;
    };
    return { client, project, home, audit };
  }

  describe("identidad del servidor", () => {
    it("al conectarse anuncia su nombre, su sitio y su logo con direcciones absolutas del origen configurado", async () => {
      const { client } = await connect("read");
      expect(client.getServerVersion()).toMatchObject({
        name: "pagespeed",
        title: "PageSpeed",
        websiteUrl: "https://app.test",
        icons: [
          { src: "https://app.test/pwa/icon-512.png", mimeType: "image/png", sizes: ["512x512"] },
          { src: "https://app.test/icon.svg", mimeType: "image/svg+xml", sizes: ["any"] },
        ],
      });
      // Los archivos a los que apuntan existen (se sirven sin sesión desde public/ y src/app/).
      const { existsSync } = await import("node:fs");
      expect(existsSync("public/pwa/icon-512.png")).toBe(true);
      expect(existsSync("src/app/icon.svg")).toBe(true);
    });
  });

  describe("acceso", () => {
    const raw = (key: string | null, extra: { headers?: Record<string, string> } = {}) =>
      fetchVia(key, () => deps)(URL_MCP, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...extra.headers },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });

    it("sin clave, con clave inventada o revocada responde 401", async () => {
      const none = await raw(null);
      expect(none.status).toBe(401);
      expect(none.headers.get("www-authenticate")).toContain("Bearer");
      expect((await raw(`pagespeed_${"a".repeat(43)}`)).status).toBe(401);
      expect((await raw("no-es-clave")).status).toBe(401);
      const { key, view } = await createApiKey({ name: "clave-de-prueba", preset: "read", access: "all" }, db);
      expect((await raw(key)).status).toBe(200);
      await revokeApiKey(view.id, db);
      expect((await raw(key)).status).toBe(401);
    });

    it("en la base solo queda el hash de la clave, y se anota su último uso", async () => {
      const { key, view } = await createApiKey({ name: "clave-de-prueba", preset: "read", access: "all" }, db);
      const [row] = await db.select().from(s.mcpApiKeys);
      expect(JSON.stringify(row)).not.toContain(key.slice(4));
      expect(row!.keyHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row!.lastUsedAt).toBeNull();
      await raw(key);
      const [after] = await db.select().from(s.mcpApiKeys).where(eq(s.mcpApiKeys.id, view.id));
      expect(after!.lastUsedAt).not.toBeNull();
    });

    it("rechaza un Origin ajeno, acepta el propio y solo admite POST", async () => {
      const { key } = await createApiKey({ name: "clave-de-prueba", preset: "read", access: "all" }, db);
      expect((await raw(key, { headers: { Origin: "https://evil.test" } })).status).toBe(403);
      expect((await raw(key, { headers: { Origin: "https://app.test" } })).status).toBe(200);
      const get = await fetchVia(key, () => deps)(URL_MCP, { method: "GET", headers: { Accept: "text/event-stream" } });
      expect(get.status).toBe(405);
    });

    it("frena las claves inválidas repetidas por IP y las llamadas excesivas por clave", async () => {
      deps.limits = { perKey: new AttemptLimiter({ max: 3, windowMs: 60_000 }), badAuthPerIp: new AttemptLimiter({ max: 4, windowMs: 60_000 }) };
      for (let i = 0; i < 4; i++) expect((await raw("mala")).status).toBe(401);
      const blocked = await raw("mala");
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("retry-after")).toMatch(/^\d+$/);
      deps.ip = "8.8.8.8";
      const { key } = await createApiKey({ name: "clave-de-prueba", preset: "read", access: "all" }, db);
      for (let i = 0; i < 3; i++) expect((await raw(key)).status).toBe(200);
      expect((await raw(key)).status).toBe(429);
    });
  });

  describe("alcance de las claves", () => {
    it("cada preset expone solo sus herramientas", async () => {
      const names = async (p: "read" | "audit" | "configure") => (await (await connect(p)).client.listTools()).tools.map((t) => t.name).sort();
      const read = await names("read");
      expect(read).toEqual(["get_audit", "get_audit_history", "get_audit_status", "get_project", "get_thresholds", "list_projects", "list_routes"]);
      expect(await names("audit")).toEqual([...read, "discover_routes", "run_audit"].sort());
      expect(await names("configure")).toEqual([...read, "add_route", "discover_routes", "run_audit", "set_route_monitored", "set_thresholds"].sort());
    });

    it("una herramienta fuera del alcance no existe para esa clave", async () => {
      const { client } = await connect("read");
      const out = await client.callTool({ name: "run_audit", arguments: { route_id: "00000000-0000-4000-8000-000000000000" } }).then((r) => r, (e: Error) => e);
      const msg = out instanceof Error ? out.message : JSON.stringify(out);
      expect(msg).toMatch(/not found|no existe|Unknown tool|disabled/i);
    });

    it("todas las herramientas declaran si solo leen y describen sus parámetros", async () => {
      const { client } = await connect("configure");
      for (const t of (await client.listTools()).tools) {
        expect(t.annotations?.readOnlyHint, t.name).toBeTypeOf("boolean");
        expect(t.annotations?.destructiveHint, t.name).toBe(false);
        expect(t.description!.length, t.name).toBeGreaterThan(30);
      }
    });
  });

  describe("lectura", () => {
    it("lista y detalla proyectos con rutas, umbrales, alertas y última puntuación", async () => {
      const { project, home, audit } = await seed();
      await audit("mobile", 14, 60, 80);
      const last = await audit("mobile", 1, 70, 69);
      await alerts.evaluateAudit(last.id, { db });
      const { client: agent } = await connect("read");

      const list = await call(agent, "list_projects");
      expect(list.json.projects).toEqual([{ project_id: project.id, name: "Tienda", client: "Acme", phase: "production", base_url: "https://acme.test", audit_frequency: "weekly" }]);
      expect((await call(agent, "list_projects", { client: "zzz" })).json.projects).toEqual([]);
      expect((await call(agent, "list_projects", { client: "ACM" })).json.projects).toHaveLength(1);

      const detail = (await call(agent, "get_project", { project_id: project.id })).json;
      expect(detail.project).toMatchObject({ name: "Tienda", phase: "production", allowed_hosts: ["acme.test"] });
      expect(detail.routes).toEqual([{ route_id: home.id, path: "/", monitored: true, source: "manual" }]);
      expect(detail.thresholds).toHaveLength(4);
      expect(detail.open_alerts.map((a: { summary: string }) => a.summary).sort()).toEqual(["Rendimiento 70 (mínimo 80)", "SEO 69 (mínimo 90)"]);
      expect(detail.latest_scores[0]).toMatchObject({ path: "/", profile: "mobile", scores: { performance: 70, seo: 69 }, change_vs_previous: { performance: "+10", seo: "-11" } });
      expect(JSON.stringify(detail)).not.toMatch(/magic|password|token|contact|auth|cookie|secret/i);

      const th = await call(agent, "get_thresholds", { project_id: project.id });
      expect(th.json.thresholds.find((t: { metric: string }) => t.metric === "seo")).toEqual({ metric: "seo", min_score: 90, enabled: true });
      expect((await call(agent, "list_routes", { project_id: project.id, only_monitored: true })).json.routes).toHaveLength(1);
    });

    it("devuelve el historial por perfil, más reciente primero y respetando el periodo", async () => {
      const { home, audit } = await seed();
      await audit("mobile", 100, 10);
      await audit("mobile", 20, 50);
      await audit("mobile", 2, 80);
      await audit("desktop", 3, 99);
      const { client: agent } = await connect("read");
      const h = (await call(agent, "get_audit_history", { route_id: home.id, days: 30 })).json;
      expect(h.route).toEqual({ route_id: home.id, path: "/" });
      expect(h.history.mobile.map((r: { performance: number }) => r.performance)).toEqual([80, 50]);
      expect(h.history.desktop).toHaveLength(1);
      expect(h.history.mobile[0]).toMatchObject({ seo: 95, lcp_ms: 2100, tbt_ms: 90, cls: 0.01 });
      const only = (await call(agent, "get_audit_history", { route_id: home.id, profile: "desktop" })).json;
      expect(Object.keys(only.history)).toEqual(["desktop"]);
      expect((await call(agent, "get_audit_history", { route_id: home.id, days: 365, limit: 1 })).json.history.mobile).toHaveLength(1);
    });

    it("get_audit y get_audit_status: resumen, detalles no disponibles y ids desconocidos", async () => {
      const { audit } = await seed();
      const a = await audit("mobile", 1, 75);
      const { client: agent } = await connect("read");
      const one = (await call(agent, "get_audit", { audit_id: a.id })).json;
      expect(one).toMatchObject({ audit_id: a.id, status: "succeeded", profile: "mobile", route_path: "/", scores: { performance: 75, seo: 95 }, lab: { lcp_ms: 2100, cls: 0.01 } });
      const withDetails = (await call(agent, "get_audit", { audit_id: a.id, include_details: true })).json;
      expect(withDetails.details).toBeNull(); // R2 no responde en la prueba
      expect(withDetails.details_note).toContain("informe completo");

      const st = (await call(agent, "get_audit_status", { audit_ids: [a.id, "00000000-0000-4000-8000-000000000000"] })).json;
      expect(st.audits.map((x: { status: string }) => x.status)).toEqual(["succeeded", "not_found"]);
    });

    it("los errores de negocio llegan como mensaje claro y los parámetros inválidos se rechazan", async () => {
      const { client: agent } = await connect("read");
      const nf = await call(agent, "get_project", { project_id: "00000000-0000-4000-8000-000000000000" });
      expect(nf.isError).toBe(true);
      expect(nf.text).toContain("Proyecto no encontrado");
      const bad = await agent.callTool({ name: "get_project", arguments: { project_id: "no-es-uuid" } }).then((r) => JSON.stringify(r), (e: Error) => e.message);
      expect(bad).toMatch(/uuid|identificador|invalid/i);
    });
  });

  describe("auditorías", () => {
    it("run_audit encola con la marca del agente, es idempotente y respeta la fase", async () => {
      const { project, home } = await seed("production");
      const { client: agent } = await connect("audit");
      const first = (await call(agent, "run_audit", { route_id: home.id })).json;
      expect(first).toMatchObject({ created: 2, already_pending: 0 });
      expect(first.audits.map((a: { profile: string; status: string }) => `${a.profile}:${a.status}`).sort()).toEqual(["desktop:queued", "mobile:queued"]);
      const rows = await db.select().from(s.auditLogs);
      expect(rows.every((r) => r.trigger === "mcp" && r.requestedBy === "mcp:agente-audit")).toBe(true);
      expect((await queue.getJobCounts("waiting", "prioritized")).prioritized).toBe(2);

      const again = (await call(agent, "run_audit", { route_id: home.id })).json;
      expect(again).toMatchObject({ created: 0, already_pending: 2 });
      expect(await db.select().from(s.auditLogs)).toHaveLength(2);

      await db.delete(s.auditLogs);
      const mobile = (await call(agent, "run_audit", { route_id: home.id, profile: "mobile" })).json;
      expect(mobile.created).toBe(1);
      void project;
    });

    it("en desarrollo, sin perfil audita móvil y escritorio, y con perfil solo ese", async () => {
      const { home } = await seed("development");
      const { client: agent } = await connect("audit");
      const both = await call(agent, "run_audit", { route_id: home.id });
      expect(both.isError).toBeFalsy();
      expect(both.json.created).toBe(2);
      await db.delete(s.auditLogs);
      expect((await call(agent, "run_audit", { route_id: home.id, profile: "desktop" })).json.created).toBe(1);
    });

    it("con una URL crea una ruta puntual sin monitoreo y solo en hosts permitidos", async () => {
      const { project } = await seed("production");
      const { client: agent } = await connect("audit");
      const ok = (await call(agent, "run_audit", { project_id: project.id, url: "https://acme.test/oferta?x=1#top", profile: "mobile" })).json;
      expect(ok.audits[0]).toMatchObject({ route_path: "/oferta", profile: "mobile" });
      const [adhoc] = await db.select().from(s.routes).where(eq(s.routes.path, "/oferta"));
      expect(adhoc).toMatchObject({ source: "adhoc", monitored: false, url: "https://acme.test/oferta" });

      const evil = await call(agent, "run_audit", { project_id: project.id, url: "https://evil.test/", profile: "mobile" });
      expect(evil.isError).toBe(true);
      const internal = await call(agent, "run_audit", { project_id: project.id, url: "http://169.254.169.254/latest", profile: "mobile" });
      expect(internal.isError).toBe(true);
      expect(await db.select().from(s.routes).where(eq(s.routes.path, "/latest"))).toHaveLength(0);

      const none = await call(agent, "run_audit", { profile: "mobile" });
      expect(none.isError).toBe(true);
      expect(none.text).toContain("route_id");
    });

    it("con wait_seconds espera al resultado y, si no llega, avisa cómo consultarlo", async () => {
      const { home } = await seed("production");
      const { client: agent } = await connect("audit");
      // Mientras "duerme", la auditoría termina como lo haría el worker.
      sleeps.push(async () => {
        await db.update(s.auditLogs).set({ status: "succeeded", scorePerformance: 88, scoreSeo: 99, scoreAccessibility: 100, scoreBestPractices: 100, finishedAt: new Date() });
      });
      const done = (await call(agent, "run_audit", { route_id: home.id, profile: "mobile", wait_seconds: 5 })).json;
      expect(done.audits[0]).toMatchObject({ status: "succeeded", scores: { performance: 88 } });
      expect(done.note).toBeUndefined();

      await db.delete(s.auditLogs);
      sleeps = [];
      const pending = (await call(agent, "run_audit", { route_id: home.id, profile: "desktop", wait_seconds: 1 })).json;
      expect(pending.audits[0].status).toBe("queued");
      expect(pending.note).toContain("get_audit_status");
    });

    it("sin worker en línea lo dice en lugar de dejar auditorías sin consumir", async () => {
      const { home } = await seed("production");
      await redis.del("aoc:worker:heartbeat");
      const { client: agent } = await connect("audit");
      const r = await call(agent, "run_audit", { route_id: home.id });
      expect(r.isError).toBe(true);
      expect(r.text).toContain("worker");
      expect(await db.select().from(s.auditLogs)).toHaveLength(0);
    });

    it("discover_routes informa de un sitemap inaccesible sin filtrar detalles internos", async () => {
      const { project } = await seed("production");
      const { client: agent } = await connect("audit");
      const r = await call(agent, "discover_routes", { project_id: project.id });
      expect(r.isError).toBe(true);
      expect(r.text.length).toBeLessThan(300);
    });
  });

  describe("configuración", () => {
    it("cambia umbrales, agrega rutas y activa o no su monitoreo", async () => {
      const { project, home } = await seed("production");
      const { client: agent } = await connect("configure");

      const th = (await call(agent, "set_thresholds", { project_id: project.id, thresholds: [{ metric: "seo", min_score: 70 }, { metric: "performance", min_score: 60, enabled: false }] })).json;
      expect(th.thresholds.find((t: { metric: string }) => t.metric === "seo")).toEqual({ metric: "seo", min_score: 70, enabled: true });
      expect(th.thresholds.find((t: { metric: string }) => t.metric === "performance")).toEqual({ metric: "performance", min_score: 60, enabled: false });
      expect(th.thresholds.find((t: { metric: string }) => t.metric === "accessibility")?.min_score).toBe(90); // intacto

      const added = (await call(agent, "add_route", { project_id: project.id, path: "/contacto", label: "Contacto" })).json.route;
      expect(added).toMatchObject({ path: "/contacto", monitored: true });
      const dup = await call(agent, "add_route", { project_id: project.id, path: "/contacto" });
      expect(dup.isError).toBe(true);
      expect(dup.text).toContain("ya existe");
      expect((await call(agent, "add_route", { project_id: project.id, path: "https://evil.test/x" })).isError).toBe(true);

      expect((await call(agent, "set_route_monitored", { route_id: home.id, monitored: false })).json.route.monitored).toBe(false);
      const bad = await agent.callTool({ name: "set_thresholds", arguments: { project_id: project.id, thresholds: [{ metric: "seo", min_score: 101 }] } }).then((r) => JSON.stringify(r), (e: Error) => e.message);
      expect(bad).toMatch(/101|too_big|less than|menor|invalid/i);
      const [seo] = await db.select().from(s.alertThresholds).where(eq(s.alertThresholds.metric, "seo"));
      expect(seo!.minScore).toBe(70);
    });

    it("el tope de rutas puntuales evita llenar un proyecto de URLs sueltas", async () => {
      const { project } = await seed("production");
      for (let i = 0; i < routes.MAX_ADHOC_ROUTES; i++) await routes.findOrCreateAdhocRoute(project.id, `/p${i}`, db);
      const { client: agent } = await connect("audit");
      const r = await call(agent, "run_audit", { project_id: project.id, url: "/una-mas", profile: "mobile" });
      expect(r.isError).toBe(true);
      expect(r.text).toContain("rutas puntuales");
      // Una ruta que ya existe sí se puede auditar.
      expect((await call(agent, "run_audit", { project_id: project.id, url: "/p3", profile: "mobile" })).isError).toBe(false);
    });
  });

  describe("alcance por clientes y proyectos", () => {
    /** Dos clientes con un proyecto cada uno, y un segundo proyecto del primero. */
    async function seedTwo() {
      const a = await seed("production");
      const clientB = await clients.createClient({ name: "Beta" }, db);
      const projectB = await projects.createProject(clientB.id, { name: "Blog", baseUrl: "https://beta.test" }, db);
      const routeB = await routes.addRoute(projectB.id, { path: "/" }, db);
      const projectA2 = await projects.createProject(a.client.id, { name: "Intranet", baseUrl: "https://acme.test" }, db);
      const routeA2 = await routes.addRoute(projectA2.id, { path: "/" }, db);
      const auditB = await db.insert(s.auditLogs).values({
        projectId: projectB.id, routeId: routeB.id, profile: "mobile", trigger: "scheduled", phaseAtRun: "production", status: "succeeded",
        scorePerformance: 70, scoreSeo: 90, scoreAccessibility: 100, scoreBestPractices: 100, r2Key: "k", queuedAt: new Date(), finishedAt: new Date(),
      }).returning().then((r) => r[0]!);
      return { ...a, clientB, projectB, routeB, projectA2, routeA2, auditB };
    }

    it("una clave de un cliente ve todos sus proyectos (también los nuevos) y ninguno de los demás", async () => {
      const t = await seedTwo();
      const { client: agent } = await connect("configure", { clientIds: [t.client.id] });
      const listed = (await call(agent, "list_projects")).json.projects.map((p: { project_id: string }) => p.project_id).sort();
      expect(listed).toEqual([t.project.id, t.projectA2.id].sort());
      // Un proyecto creado después de la clave, del mismo cliente, entra solo.
      const later = await projects.createProject(t.client.id, { name: "Nuevo", baseUrl: "https://acme.test" }, db);
      expect((await call(agent, "list_projects")).json.projects.map((p: { project_id: string }) => p.project_id)).toContain(later.id);
      expect((await call(agent, "get_project", { project_id: t.projectA2.id })).isError).toBe(false);
    });

    it("una clave de un proyecto solo ve ese proyecto, no los demás del mismo cliente", async () => {
      const t = await seedTwo();
      const { client: agent } = await connect("read", { projectIds: [t.project.id] });
      expect((await call(agent, "list_projects")).json.projects.map((p: { project_id: string }) => p.project_id)).toEqual([t.project.id]);
      expect((await call(agent, "get_project", { project_id: t.project.id })).isError).toBe(false);
      expect((await call(agent, "get_project", { project_id: t.projectA2.id })).isError).toBe(true);
    });

    it("lo que queda fuera se responde como si no existiera, en todas las herramientas", async () => {
      const t = await seedTwo();
      const { client: agent } = await connect("configure", { clientIds: [t.client.id] });
      const denied = async (name: string, args: Record<string, unknown>, what: string) => {
        const r = await call(agent, name, args);
        expect([name, r.isError, r.text]).toEqual([name, true, expect.stringContaining(`${what} no encontrad`)]);
      };
      await denied("get_project", { project_id: t.projectB.id }, "Proyecto");
      await denied("list_routes", { project_id: t.projectB.id }, "Proyecto");
      await denied("get_thresholds", { project_id: t.projectB.id }, "Proyecto");
      await denied("discover_routes", { project_id: t.projectB.id }, "Proyecto");
      await denied("set_thresholds", { project_id: t.projectB.id, thresholds: [{ metric: "seo", min_score: 33 }] }, "Proyecto");
      await denied("add_route", { project_id: t.projectB.id, path: "/nueva" }, "Proyecto");
      await denied("get_audit_history", { route_id: t.routeB.id }, "Ruta");
      await denied("set_route_monitored", { route_id: t.routeB.id, monitored: false }, "Ruta");
      await denied("run_audit", { route_id: t.routeB.id, profile: "mobile" }, "Ruta");
      await denied("run_audit", { project_id: t.projectB.id, url: "/x", profile: "mobile" }, "Proyecto");
      await denied("get_audit", { audit_id: t.auditB.id }, "Auditoría");
      // Nada se cambió ni se encoló en el proyecto ajeno.
      expect(await db.select().from(s.auditLogs).where(eq(s.auditLogs.projectId, t.projectB.id))).toHaveLength(1);
      expect((await db.select().from(s.alertThresholds).where(eq(s.alertThresholds.projectId, t.projectB.id))).some((x) => x.minScore === 33)).toBe(false);
      expect((await db.select().from(s.routes).where(eq(s.routes.projectId, t.projectB.id))).map((r) => r.path)).toEqual(["/"]);
      const status = (await call(agent, "get_audit_status", { audit_ids: [t.auditB.id] })).json.audits;
      expect(status).toEqual([{ audit_id: t.auditB.id, status: "not_found" }]);
    });

    it("dentro del alcance todo funciona igual y una clave de acceso total no cambia", async () => {
      const t = await seedTwo();
      const scoped = (await connect("audit", { clientIds: [t.clientB.id] })).client;
      expect((await call(scoped, "run_audit", { route_id: t.routeB.id, profile: "mobile" })).json.created).toBe(1);
      expect((await call(scoped, "get_audit", { audit_id: t.auditB.id })).json.audit_id).toBe(t.auditB.id);
      const all = (await connect("read")).client;
      expect((await call(all, "list_projects")).json.projects).toHaveLength(3);
      expect((await call(all, "get_project", { project_id: t.projectB.id })).isError).toBe(false);
    });

    it("al crear la clave se valida el alcance", async () => {
      const t = await seedTwo();
      await expect(createApiKey({ name: "sin alcance", preset: "read", access: "selected" }, db)).rejects.toThrow(/al menos un cliente o un proyecto/);
      await expect(createApiKey({ name: "sin alcance", preset: "read" }, db)).rejects.toThrow();
      await expect(createApiKey({ name: "id falso", preset: "read", access: "selected", clientIds: ["00000000-0000-4000-8000-000000000000"] }, db)).rejects.toThrow(/ya no existe/);
      // Un proyecto de un cliente ya elegido es redundante: solo se guarda el cliente.
      const { view } = await createApiKey({ name: "mixta", preset: "read", access: "selected", clientIds: [t.client.id], projectIds: [t.project.id, t.projectB.id] }, db);
      expect(view.scope.all).toBe(false);
      expect(view.scope.clients.map((c) => c.name)).toEqual(["Acme"]);
      expect(view.scope.projects.map((p) => p.name)).toEqual(["Blog"]);
      const full = await createApiKey({ name: "total", preset: "read", access: "all", clientIds: [t.client.id] }, db);
      expect(full.view.scope).toEqual({ all: true, clients: [], projects: [] });
    });
  });

  describe("gestión de claves: rotar, editar y eliminar", () => {
    const listTools = (key: string) =>
      fetchVia(key, () => deps)(URL_MCP, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });

    it("rotar invalida la clave anterior al instante y la nueva conserva permisos y alcance", async () => {
      const t = await seed("production");
      const { key: old, id } = await connect("audit", { projectIds: [t.project.id] });
      expect((await listTools(old)).status).toBe(200);

      const { key: fresh, view } = await rotateApiKey(id, db);
      expect(fresh).not.toBe(old);
      expect(fresh.startsWith("pagespeed_")).toBe(true);
      expect(view.rotatedAt).toBeInstanceOf(Date);
      expect(view).toMatchObject({ name: "agente-audit", preset: "audit", active: true });
      expect(view.scope.projects.map((p) => p.id)).toEqual([t.project.id]);

      expect((await listTools(old)).status).toBe(401);
      expect((await listTools(fresh)).status).toBe(200);
      const [row] = await db.select().from(s.mcpApiKeys).where(eq(s.mcpApiKeys.id, id));
      expect(row!.lastUsedAt === null || row!.lastUsedAt.getTime() >= row!.rotatedAt!.getTime() - 1000).toBe(true);
      expect(row!.keyHash).not.toContain(fresh);
    });

    it("editar cambia permisos y alcance, y un agente ya conectado lo nota en su siguiente llamada", async () => {
      const t = await seed("production");
      const clientB = await clients.createClient({ name: "Beta" }, db);
      const projectB = await projects.createProject(clientB.id, { name: "Blog", baseUrl: "https://beta.test" }, db);
      const { client: agent, key, id } = await connect("read", { projectIds: [t.project.id] });
      expect((await agent.listTools()).tools.map((x) => x.name)).not.toContain("run_audit");
      expect((await call(agent, "list_projects")).json.projects).toHaveLength(1);

      const view = await updateApiKey(id, { name: "Agente renombrado", preset: "audit", access: "selected", clientIds: [clientB.id], projectIds: [] }, db);
      expect(view).toMatchObject({ name: "Agente renombrado", preset: "audit" });
      expect(view.scope.clients.map((c) => c.name)).toEqual(["Beta"]);

      expect((await agent.listTools()).tools.map((x) => x.name)).toContain("run_audit");
      expect((await call(agent, "list_projects")).json.projects.map((p: { project_id: string }) => p.project_id)).toEqual([projectB.id]);
      expect((await call(agent, "get_project", { project_id: t.project.id })).isError).toBe(true);
      expect((await listTools(key)).status).toBe(200); // la clave es la misma

      await updateApiKey(id, { name: "Agente renombrado", preset: "configure", access: "all" }, db);
      expect((await call(agent, "list_projects")).json.projects).toHaveLength(2);
    });

    it("al editar se valida igual que al crear", async () => {
      const t = await seed("production");
      const { id } = await connect("read");
      await expect(updateApiKey(id, { name: "x", preset: "read", access: "all" }, db)).rejects.toThrow(/al menos 2 caracteres/);
      await expect(updateApiKey(id, { name: "Agente", preset: "read", access: "selected" }, db)).rejects.toThrow(/al menos un cliente o un proyecto/);
      await expect(updateApiKey(id, { name: "Agente", preset: "read", access: "selected", clientIds: ["00000000-0000-4000-8000-000000000000"] }, db)).rejects.toThrow(/ya no existe/);
      const ok = await updateApiKey(id, { name: "Agente", preset: "read", access: "selected", clientIds: [t.client.id], projectIds: [t.project.id] }, db);
      expect(ok.scope.projects).toEqual([]); // el proyecto ya entra por su cliente
    });

    it("una clave revocada no se edita ni se rota; solo se elimina estando revocada", async () => {
      const { id } = await connect("read");
      await expect(deleteApiKey(id, db)).rejects.toThrow(/Revócala primero/);
      expect(await db.select().from(s.mcpApiKeys)).toHaveLength(1);

      await revokeApiKey(id, db);
      await expect(rotateApiKey(id, db)).rejects.toThrow(/ya está revocada/);
      await expect(updateApiKey(id, { name: "Otro nombre", preset: "read", access: "all" }, db)).rejects.toThrow(/ya está revocada/);

      await deleteApiKey(id, db);
      expect(await db.select().from(s.mcpApiKeys)).toHaveLength(0);
      await expect(deleteApiKey(id, db)).rejects.toThrow(/no existe/);
      await expect(deleteApiKey("no-es-uuid", db)).rejects.toThrow(/no encontrad/);
    });

    it("las auditorías que lanzó una clave conservan su nombre al eliminarla", async () => {
      const t = await seed("production");
      const { client: agent, id } = await connect("audit");
      await call(agent, "run_audit", { route_id: t.home.id, profile: "mobile" });
      await revokeApiKey(id, db);
      await deleteApiKey(id, db);
      const rows = await db.select().from(s.auditLogs).where(eq(s.auditLogs.trigger, "mcp"));
      expect(rows.map((r) => r.requestedBy)).toEqual(["mcp:agente-audit"]);
    });
  });
});
