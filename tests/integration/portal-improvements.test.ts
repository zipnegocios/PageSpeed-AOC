import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFakeS3, type FakeS3 } from "../helpers/fake-s3";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import * as s from "@/server/db/schema";
import type { AuditImprovements } from "@/server/domain/improvements";
import * as alerts from "@/server/services/alerts";
import * as clients from "@/server/services/clients";
import * as portal from "@/server/services/portal";
import * as projects from "@/server/services/projects";
import * as routes from "@/server/services/routes";
import { createR2, type R2Store } from "@/server/storage/r2";

const url = process.env.TEST_DATABASE_URL;
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

const STORED: AuditImprovements = {
  v: 1,
  categories: {
    seo: [
      { id: "meta-description", title: "El documento no tiene una meta descripción", impact: { count: 1 } },
      { id: "algo-nuevo", title: "Título de Lighthouse en español", impact: { ms: 1900 } },
    ],
  },
};

describe.skipIf(!url)("portal: mejoras por página", () => {
  const { db, pool } = createDb(url ?? "", 4);
  let s3: FakeS3;
  let r2: R2Store;

  beforeAll(async () => {
    await runMigrations(url!, "./drizzle");
    s3 = await startFakeS3();
    r2 = createR2({ endpoint: s3.url, region: "auto", bucket: "reportes", accessKeyId: "ak", secretAccessKey: "sk" });
  });
  afterAll(async () => {
    r2.destroy();
    await s3.close();
    await pool.end();
  });
  beforeEach(async () => {
    await db.execute(sql`truncate clients, settings restart identity cascade`);
    s3.objects.clear();
  });

  async function setup(paths = ["/", "/contacto"]) {
    const client = await clients.createClient({ name: "Acme" }, db);
    const project = await projects.createProject(client.id, { name: "Sitio Acme", baseUrl: "https://acme.test" }, db);
    await db.update(s.projects).set({ phase: "production" }).where(eq(s.projects.id, project.id));
    const created = [];
    for (const path of paths) created.push(await routes.addRoute(project.id, { path }, db));
    return { client, project, routes: created };
  }

  async function audit(projectId: string, routeId: string, profile: "mobile" | "desktop", v: { seo?: number; improvements?: AuditImprovements | null; r2Key?: string; failed?: boolean } = {}) {
    const [row] = await db
      .insert(s.auditLogs)
      .values({
        projectId, routeId, profile, trigger: "scheduled", phaseAtRun: "production",
        status: v.failed ? "failed" : "succeeded",
        scorePerformance: v.failed ? null : 95, scoreSeo: v.failed ? null : (v.seo ?? 95), scoreAccessibility: v.failed ? null : 100, scoreBestPractices: v.failed ? null : 100,
        r2Key: v.failed ? null : (v.r2Key ?? "k"), improvements: v.improvements ?? null, queuedAt: daysAgo(1), finishedAt: daysAgo(1),
      })
      .returning();
    return row!;
  }

  const load = async (a: { client: { id: string }; project: { id: string } }) => (await portal.getPortalProject(a.client.id, a.project.id, db))!;

  it("une cada alerta abierta con las causas guardadas de su última auditoría, en frases llanas y con su impacto", async () => {
    const a = await setup();
    const row = await audit(a.project.id, a.routes[1]!.id, "mobile", { seo: 60, improvements: STORED });
    await alerts.evaluateAudit(row.id, { db });
    const out = await portal.getPortalImprovements(await load(a), db, { r2 });
    expect(out.total).toBe(1);
    expect(out.pages).toHaveLength(1);
    const page = out.pages[0]!;
    expect(page).toMatchObject({ path: "/contacto", title: "Contacto" });
    expect(page.blocks).toHaveLength(1);
    const block = page.blocks[0]!;
    expect(block).toMatchObject({ profile: "mobile", kind: "threshold", category: "seo", value: 60, auditId: row.id });
    expect(block.items[0]).toEqual({ id: "meta-description", text: "La página no tiene una descripción para mostrar en los buscadores", impact: "1 elemento" });
    expect(block.items[1]).toEqual({ id: "algo-nuevo", text: "Título de Lighthouse en español", impact: "≈ 1,9 s" });
  });

  it("una auditoría anterior a la migración se lee de R2 una vez y el resumen queda guardado", async () => {
    const a = await setup();
    const lhr = {
      lighthouseVersion: "13.0.0",
      categories: { seo: { title: "SEO", score: 0.6, auditRefs: [{ id: "meta-description", weight: 1 }] } },
      audits: { "meta-description": { title: "Sin meta descripción", score: 0, scoreDisplayMode: "binary", details: { items: [{}] } } },
    };
    await r2.putAuditJson("acme/sitio/contacto/mobile/x.json.gz", lhr);
    const row = await audit(a.project.id, a.routes[1]!.id, "mobile", { seo: 60, improvements: null, r2Key: "acme/sitio/contacto/mobile/x.json.gz" });
    await alerts.evaluateAudit(row.id, { db });

    const first = await portal.getPortalImprovements(await load(a), db, { r2 });
    expect(first.pages[0]!.blocks[0]!.items.map((i) => i.id)).toEqual(["meta-description"]);
    const [saved] = await db.select({ improvements: s.auditLogs.improvements }).from(s.auditLogs).where(eq(s.auditLogs.id, row.id));
    expect(saved!.improvements).toMatchObject({ v: 1, categories: { seo: [{ id: "meta-description" }] } });

    // La segunda vez ya no necesita R2: se lee de la base.
    s3.objects.clear();
    const second = await portal.getPortalImprovements(await load(a), db, { r2 });
    expect(second.pages[0]!.blocks[0]!.items.map((i) => i.id)).toEqual(["meta-description"]);
  });

  it("si R2 no tiene el resultado, la página sigue apareciendo (sin causas) en lugar de perderse el aviso", async () => {
    const a = await setup();
    const row = await audit(a.project.id, a.routes[1]!.id, "mobile", { seo: 60, improvements: null, r2Key: "no-existe.json.gz" });
    await alerts.evaluateAudit(row.id, { db });
    const out = await portal.getPortalImprovements(await load(a), db, { r2 });
    expect(out.total).toBe(1);
    expect(out.pages[0]!.blocks[0]!.items).toEqual([]);
  });

  it("un fallo de auditoría sale como aviso sin causas y las páginas con más pendientes van primero", async () => {
    const a = await setup(["/", "/contacto", "/blog"]);
    const f = await audit(a.project.id, a.routes[0]!.id, "mobile", { failed: true });
    await alerts.evaluateFailure(f.id, { db });
    for (const profile of ["mobile", "desktop"] as const) {
      const row = await audit(a.project.id, a.routes[2]!.id, profile, { seo: 50, improvements: STORED });
      await alerts.evaluateAudit(row.id, { db });
    }
    const out = await portal.getPortalImprovements(await load(a), db, { r2 });
    expect(out.total).toBe(3);
    expect(out.pages.map((p) => p.path)).toEqual(["/blog", "/"]); // /blog tiene 2 pendientes; «/» tiene 1
    const home = out.pages[1]!;
    expect(home.title).toBe("Inicio");
    expect(home.blocks[0]).toMatchObject({ kind: "audit_failure", category: null, items: [] });
  });

  it("sin alertas no hay nada y no se toca R2", async () => {
    const a = await setup();
    await audit(a.project.id, a.routes[0]!.id, "mobile");
    expect(await portal.getPortalImprovements(await load(a), db, { r2 })).toEqual({ pages: [], total: 0 });
  });

  it("no expone datos internos", async () => {
    const a = await setup();
    const row = await audit(a.project.id, a.routes[1]!.id, "mobile", { seo: 60, improvements: STORED });
    await alerts.evaluateAudit(row.id, { db });
    expect(JSON.stringify(await portal.getPortalImprovements(await load(a), db, { r2 }))).not.toMatch(/allowedHosts|magicToken|contactEmail|r2Key|clientId|projectId/);
  });
});
