import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import * as s from "@/server/db/schema";
import * as clients from "@/server/services/clients";
import { getPortalTraffic } from "@/server/services/portal-traffic";
import * as projects from "@/server/services/projects";
import * as routes from "@/server/services/routes";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("portal: pestaña Tráfico", () => {
  const { db, pool } = createDb(url ?? "", 4);
  beforeAll(async () => {
    await runMigrations(url!, "./drizzle");
  });
  afterAll(() => pool.end());
  beforeEach(async () => {
    await db.execute(sql`truncate clients, settings restart identity cascade`);
  });

  async function setup(opts: { visible?: boolean; phase?: "production" | "development" } = {}) {
    const client = await clients.createClient({ name: "Acme" }, db);
    const project = await projects.createProject(client.id, { name: "Sitio Acme", baseUrl: "https://acme.test" }, db);
    await db.update(s.projects).set({ phase: opts.phase ?? "production", seoClientVisible: opts.visible ?? true }).where(eq(s.projects.id, project.id));
    return { client, project };
  }

  async function crawlRun(projectId: string, issues: Array<{ page: string; code: string; severity: "error" | "warning" | "info"; evidence?: Record<string, string | number | boolean | string[]> }>, pages: Array<{ path: string; title: string | null }> = [], at = new Date()) {
    const [run] = await db.insert(s.seoCrawlRuns).values({ projectId, trigger: "manual", status: "succeeded", queuedAt: at, finishedAt: at, pagesCrawled: 12 }).returning();
    if (pages.length) await db.insert(s.seoCrawlPages).values(pages.map((p) => ({ runId: run!.id, path: p.path, status: 200, title: p.title })));
    if (issues.length) await db.insert(s.seoCrawlIssues).values(issues.map((i) => ({ runId: run!.id, page: i.page, code: i.code, severity: i.severity, evidence: i.evidence ?? {} })));
  }

  it("la puerta: de otro cliente, en desarrollo o sin activar para el cliente no devuelve nada", async () => {
    const a = await setup();
    const other = await clients.createClient({ name: "Beta" }, db);
    await crawlRun(a.project.id, [{ page: "/x", code: "title_missing", severity: "error" }]);
    expect(await getPortalTraffic(a.client.id, a.project, { days: 28 }, db)).not.toBeNull();
    expect(await getPortalTraffic(other.id, a.project, { days: 28 }, db)).toBeNull();
    await db.update(s.projects).set({ seoClientVisible: false }).where(eq(s.projects.id, a.project.id));
    expect(await getPortalTraffic(a.client.id, a.project, { days: 28 }, db)).toBeNull();
    await db.update(s.projects).set({ seoClientVisible: true, phase: "development" }).where(eq(s.projects.id, a.project.id));
    expect(await getPortalTraffic(a.client.id, a.project, { days: 28 }, db)).toBeNull();
  });

  it("sin Google conectado ni rastreo no hay pestaña; con solo un rastreo, solo la salud SEO", async () => {
    const a = await setup();
    expect(await getPortalTraffic(a.client.id, a.project, { days: 28 }, db)).toBeNull();
    await crawlRun(a.project.id, []);
    const out = (await getPortalTraffic(a.client.id, a.project, { days: 28 }, db))!;
    expect(out.dashboard).toBeNull();
    expect(out.health).toMatchObject({ errors: 0, warnings: 0, groups: [], changes: null, pagesCrawled: 12 });
  });

  it("la salud SEO agrupa por tema, excluye «información», usa frases llanas y títulos de página, y compara con la revisión anterior", async () => {
    const a = await setup();
    const r = await routes.addRoute(a.project.id, { path: "/servicios", label: "Servicios" }, db);
    expect(r.id).toBeTruthy();
    const old = new Date(Date.now() - 7 * 86_400_000);
    await crawlRun(a.project.id, [
      { page: "/servicios", code: "title_missing", severity: "error" },
      { page: "/viejo", code: "description_missing", severity: "warning" },
    ], [], old);
    await crawlRun(
      a.project.id,
      [
        { page: "/servicios", code: "title_missing", severity: "error" },
        { page: "/contacto", code: "title_missing", severity: "error" },
        { page: "/contacto", code: "description_missing", severity: "warning" },
        { page: "", code: "robots_missing", severity: "warning" },
        { page: "/inicio", code: "client_rendered", severity: "info" },
      ],
      [{ path: "/contacto", title: "Contacto | Acme" }, { path: "/otra", title: "Otra | Acme" }],
    );
    const h = (await getPortalTraffic(a.client.id, a.project, { days: 28 }, db))!.health!;
    expect(h.errors).toBe(2);
    expect(h.warnings).toBe(2); // la información no cuenta ni se muestra
    expect(h.changes).toEqual({ added: 3, resolved: 1 }); // nuevos: /contacto×2 y robots; resuelto: /viejo
    expect(h.groups.map((g) => g.group)).toEqual(["contenido", "indexacion"]); // más errores primero
    const contenido = h.groups[0]!;
    expect(contenido.errors).toBe(1);
    const title = contenido.issues.find((i) => i.code === "title_missing")!;
    expect(title).toMatchObject({ text: "Páginas sin título", pages: 2, added: 1, severity: "error" });
    expect(title.rows.map((r) => r.title).sort()).toEqual(["Contacto", "Servicios"]);
    const robots = h.groups[1]!.issues[0]!;
    expect(robots.rows[0]!.title).toBe("Todo el sitio");
    expect(JSON.stringify(h)).not.toContain("client_rendered");
  });

  it("las visitas y la búsqueda salen si hay Google conectado, con el título de cada página", async () => {
    const a = await setup();
    const day = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    await db.insert(s.seoIntegrations).values({ projectId: a.project.id, kind: "ga4", externalId: "1", status: "ok", syncedThrough: day, syncStatus: "ok", lastSyncAt: new Date() });
    await db.insert(s.seoTrafficDaily).values({ projectId: a.project.id, date: day, page: "/servicios", country: "Colombia", channel: "Organic Search", sessions: 40, users: 30 });
    await routes.addRoute(a.project.id, { path: "/servicios", label: "Servicios" }, db);
    const out = (await getPortalTraffic(a.client.id, a.project, { days: 28 }, db))!;
    expect(out.dashboard?.traffic?.totals.sessions).toBe(40);
    expect(out.health).toBeNull();
    expect(out.titles["/servicios"]).toBe("Servicios");
    expect(JSON.stringify(out)).not.toMatch(/credentialEnc|externalId|magicToken|contactEmail/);
  });
});
