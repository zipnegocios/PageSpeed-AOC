import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import * as s from "@/server/db/schema";
import * as clients from "@/server/services/clients";
import { getPortalMeasurements } from "@/server/services/project-measurements";
import * as projects from "@/server/services/projects";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("portal: resumen de todas las mediciones", () => {
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

  const day = () => new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);

  async function seedGoogle(projectId: string) {
    const d = day();
    await db.insert(s.seoIntegrations).values({ projectId, kind: "ga4", externalId: "1", status: "ok", syncedThrough: d, syncStatus: "ok", lastSyncAt: new Date() });
    await db.insert(s.seoTrafficDaily).values({ projectId, date: d, page: "/", country: "Colombia", channel: "Organic Search", sessions: 100, users: 80 });
    await db.insert(s.seoSourceDaily).values([
      { projectId, date: d, grp: "search", source: "google", page: "/", sessions: 50, users: 40 },
      { projectId, date: d, grp: "social", source: "instagram", page: "/", sessions: 20, users: 15 },
      { projectId, date: d, grp: "social", source: "whatsapp", page: "/", sessions: 10, users: 8 },
      { projectId, date: d, grp: "direct", source: "(direct)", page: "/", sessions: 20, users: 17 },
    ]);
  }

  it("sin SEO activado para el cliente: solo la experiencia real; el resto figura «no activado»", async () => {
    const a = await setup({ visible: false });
    const m = await getPortalMeasurements(a.client.id, a.project, { days: 28, hasLighthouse: true }, db);
    expect(m.seoAccess).toBe(false);
    expect(m.traffic).toBeNull();
    expect(m.states).toMatchObject({ speed: "included", improvements: "included", field: "pending", search: "off", traffic: "off", sources: "off", ai: "off", health: "off" });
  });

  it("otro cliente o un proyecto en desarrollo no obtiene el tráfico", async () => {
    const a = await setup();
    await seedGoogle(a.project.id);
    const other = await clients.createClient({ name: "Beta" }, db);
    expect((await getPortalMeasurements(other.id, a.project, { days: 28, hasLighthouse: true }, db)).traffic).toBeNull();
    await db.update(s.projects).set({ phase: "development" }).where(eq(s.projects.id, a.project.id));
    expect((await getPortalMeasurements(a.client.id, a.project, { days: 28, hasLighthouse: true }, db)).seoAccess).toBe(false);
  });

  it("con Google y datos reales: reparto por fuente que suma el total, redes por nombre y veredicto de experiencia real", async () => {
    const a = await setup();
    await seedGoogle(a.project.id);
    await db.insert(s.fieldData).values({
      projectId: a.project.id,
      target: "origin",
      formFactor: "mobile",
      status: "ok",
      metrics: { lcp: { p75: 2000, good: 80, needsImprovement: 15, poor: 5 }, inp: { p75: 150, good: 85, needsImprovement: 10, poor: 5 }, cls: { p75: 0.05, good: 90, needsImprovement: 8, poor: 2 } },
    });
    const m = await getPortalMeasurements(a.client.id, a.project, { days: 28, hasLighthouse: true }, db);
    const src = m.traffic!.dashboard!.sources!;
    expect(src.totals.sessions).toBe(100);
    expect(src.groups.reduce((acc, g) => acc + g.sessions, 0)).toBe(100);
    expect(src.items.filter((i) => i.group === "social").map((i) => i.label)).toEqual(["Instagram", "WhatsApp"]);
    expect(m.field).toMatchObject({ assessment: "passed", device: "mobile" });
    expect(m.field!.metrics.map((x) => [x.metric, x.rating])).toEqual([["lcp", "good"], ["inp", "good"], ["cls", "good"]]);
    expect(m.states).toMatchObject({ field: "included", traffic: "included", sources: "included", search: "pending", health: "pending" });
    expect(JSON.stringify(m)).not.toMatch(/credentialEnc|externalId|magicToken|contactEmail/);
  });
});
