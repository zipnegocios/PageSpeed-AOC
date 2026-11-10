import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import * as s from "@/server/db/schema";
import { isDomainError } from "@/server/domain/errors";
import type { MailMessage, Mailer } from "@/server/notify/mailer";
import * as alerts from "@/server/services/alerts";
import * as clients from "@/server/services/clients";
import * as projects from "@/server/services/projects";
import { buildProjectReport } from "@/server/services/report";
import { REPORT_COOLDOWN_MS, sendProjectReport } from "@/server/services/report-email";
import * as routes from "@/server/services/routes";

const dbUrl = process.env.TEST_DATABASE_URL;
const DAY = 86_400_000;
const NOW = new Date("2026-04-30T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

describe.skipIf(!dbUrl)("informe del proyecto y envío por correo", () => {
  const { db, pool } = createDb(dbUrl ?? "", 4);
  const sent: MailMessage[] = [];
  let fail = false;
  const mailer: Mailer = {
    async send(m) {
      if (fail) throw Object.assign(new Error("535 auth failed"), { code: "EAUTH" });
      sent.push(m);
    },
  };
  const fakePdf = async (_id: string, _days: number, kind: "summary" | "engineering" = "summary") => ({ filename: kind === "summary" ? "resumen-x.pdf" : "informe-ingenieria-x.pdf", pdf: Buffer.from(`%PDF-1.7 fake ${kind}`), data: {} as never });

  beforeAll(async () => { await runMigrations(dbUrl!, "./drizzle"); });
  afterAll(() => pool.end());
  beforeEach(async () => {
    await db.execute(sql`truncate clients, settings restart identity cascade`);
    sent.length = 0;
    fail = false;
  });

  async function setup(contact: { contactName?: string; contactEmail?: string } = { contactName: "Ana", contactEmail: "ana@acme.test" }) {
    const client = await clients.createClient({ name: "Acme", ...contact }, db);
    const project = await projects.createProject(client.id, { name: "Tienda", baseUrl: "https://acme.test" }, db);
    await db.update(s.projects).set({ phase: "production" }).where(eq(s.projects.id, project.id));
    const [r] = [await routes.addRoute(project.id, { path: "/" }, db)];
    return { client, project, route: r };
  }
  async function audit(projectId: string, routeId: string, profile: "mobile" | "desktop", when: Date, p: number, seo = 95) {
    const [row] = await db.insert(s.auditLogs).values({
      projectId, routeId, profile, trigger: "scheduled", phaseAtRun: "production", status: "succeeded",
      scorePerformance: p, scoreSeo: seo, scoreAccessibility: 100, scoreBestPractices: 100, lcpMs: 2000, tbtMs: 100, cls: "0.01",
      r2Key: "k", queuedAt: when, finishedAt: when,
    }).returning();
    return row!;
  }

  describe("buildProjectReport", () => {
    it("reúne estado actual con variación, puntos por mejorar y series del periodo", async () => {
      const { project, route } = await setup();
      await audit(project.id, route.id, "mobile", daysAgo(60), 40); // fuera del periodo
      await audit(project.id, route.id, "mobile", daysAgo(20), 60, 70);
      const last = await audit(project.id, route.id, "mobile", daysAgo(2), 75, 90);
      await alerts.evaluateAudit(last.id, { db });

      const r = await buildProjectReport(project.id, { days: 30, now: NOW }, db);
      expect(r).toMatchObject({ clientName: "Acme", projectName: "Tienda", contactName: "Ana", contactEmail: "ana@acme.test", days: 30, performanceThreshold: 80 });
      expect(r.latest).toHaveLength(1);
      expect(r.latest[0]!.scores.performance).toBe(75);
      expect(r.latest[0]!.changes.performance).toMatchObject({ verdict: "better", text: "15 puntos" });
      expect(r.charts).toHaveLength(1);
      expect(r.charts[0]!.points.map((p) => p.value)).toEqual([60, 75]);
      expect(r.charts[0]!.ranges.find((x) => x.metric === "seo")).toMatchObject({ first: 70, last: 90, min: 70, max: 90 });
      expect(r.improvements).toEqual([{ routePath: "/", profile: "mobile", text: "Rendimiento 75 (mínimo 80)" }]);
    });

    it("el informe de ingeniería lleva el detalle de las páginas más débiles (con tope); el resumen no", async () => {
      const { project } = await setup();
      const rs = [];
      for (let i = 0; i < 34; i++) rs.push(await routes.addRoute(project.id, { path: `/p${i}`, label: `Página ${i}` }, db));
      const stored = { v: 1, categories: { seo: [{ id: "meta-description", title: "x", impact: { count: 1 } }] } };
      for (const [i, r] of rs.entries()) {
        const a = await audit(project.id, r.id, "mobile", daysAgo(2), 30 + i);
        await db.update(s.auditLogs).set({ improvements: stored as never }).where(eq(s.auditLogs.id, a.id));
      }
      const eng = await buildProjectReport(project.id, { days: 30, now: NOW, kind: "engineering" }, db);
      expect(eng.kind).toBe("engineering");
      expect(eng.detail).toHaveLength(30); // el tope: las 30 más débiles
      expect(eng.detail[0]).toMatchObject({ path: "/p0" }); // la de peor nota primero
      expect(eng.detail[0]!.improvements?.categories.seo?.[0]?.id).toBe("meta-description");
      expect(eng.titles["/p0"]).toBe("Página 0");
      expect(eng.latest).toHaveLength(34);
      expect(eng.lighthouseVersion).toBeNull();
      const sum = await buildProjectReport(project.id, { days: 30, now: NOW }, db);
      expect(sum.kind).toBe("summary");
      expect(sum.detail).toEqual([]);
      expect(sum.daily.length).toBeGreaterThan(0);
      expect(sum.logo).toBeNull();
    });

    it("el tráfico y la salud SEO solo entran si el cliente puede verlos en su portal", async () => {
      const { project } = await setup();
      const [run] = await db.insert(s.seoCrawlRuns).values({ projectId: project.id, trigger: "manual", status: "succeeded", finishedAt: NOW, pagesCrawled: 5 }).returning();
      await db.insert(s.seoCrawlIssues).values({ runId: run!.id, page: "/x", code: "title_missing", severity: "error", evidence: {} });
      expect((await buildProjectReport(project.id, { now: NOW }, db)).seo).toBeNull(); // sin activar para el cliente
      await db.update(s.projects).set({ seoClientVisible: true }).where(eq(s.projects.id, project.id));
      const r = await buildProjectReport(project.id, { now: NOW, kind: "engineering" }, db);
      expect(r.seo?.health).toMatchObject({ errors: 1, pagesCrawled: 5 });
      expect(r.seo?.dashboard).toBeNull(); // sin Google conectado
    });

    it("un proyecto sin auditorías da un informe vacío válido", async () => {
      const { project } = await setup();
      const r = await buildProjectReport(project.id, { now: NOW }, db);
      expect(r.latest).toEqual([]);
      expect(r.charts).toEqual([]);
      expect(r.days).toBe(30);
    });

    it("rechaza un proyecto que no existe", async () => {
      const err = await buildProjectReport("00000000-0000-4000-8000-000000000000", {}, db).catch((e) => e);
      expect(isDomainError(err) && err.code).toBe("NOT_FOUND");
    });
  });

  describe("sendProjectReport", () => {
    const deps = (now: Date = NOW) => ({ mailer, appUrl: "https://app.test/", now: () => now, getPdf: fakePdf });

    it("envía al contacto con el PDF adjunto y el enlace a su portal, y lo registra", async () => {
      const { client, project } = await setup();
      const out = await sendProjectReport(project.id, 90, db, deps());
      expect(out).toEqual({ to: "ana@acme.test" });
      expect(sent).toHaveLength(1);
      const m = sent[0]!;
      expect(m).toMatchObject({ to: "ana@acme.test", subject: expect.stringMatching(/^Informes técnicos web · .+ · últimos 90 días$/) });
      // Los dos informes van adjuntos: el resumen y el de ingeniería.
      expect(m.attachments!.map((a) => a.filename)).toEqual(["resumen-x.pdf", "informe-ingenieria-x.pdf"]);
      for (const a of m.attachments!) {
        expect(a.contentType).toBe("application/pdf");
        expect(a.content.subarray(0, 5).toString()).toBe("%PDF-");
      }
      expect(m.text).toContain("Informe resumen");
      expect(m.text).toContain("Informe de ingeniería");
      expect(m.text).toContain(`https://app.test/c/${client.slug}/${project.slug}`);
      expect(m.text).toContain("90 días");

      const [n] = await db.select().from(s.notifications);
      expect(n).toMatchObject({ type: "report", status: "sent", recipient: "ana@acme.test", projectId: project.id, clientId: client.id });
      expect(n!.alertStateIds).toEqual([]);
    });

    it("sin correo de contacto explica qué hacer y no envía nada", async () => {
      const { project } = await setup({ contactName: "Ana" });
      const err = await sendProjectReport(project.id, 30, db, deps()).catch((e) => e);
      expect(isDomainError(err) && err.code).toBe("INVALID");
      expect(String(err.message)).toContain("correo de contacto");
      expect(sent).toHaveLength(0);
    });

    it("no reenvía dentro del tiempo de espera, pero sí pasado", async () => {
      const { project } = await setup();
      await sendProjectReport(project.id, 30, db, deps());
      const again = await sendProjectReport(project.id, 30, db, deps(new Date(NOW.getTime() + 60_000))).catch((e) => e);
      expect(isDomainError(again) && again.code).toBe("CONFLICT");
      expect(sent).toHaveLength(1);
      await sendProjectReport(project.id, 30, db, deps(new Date(NOW.getTime() + REPORT_COOLDOWN_MS + 1)));
      expect(sent).toHaveLength(2);
    });

    it("si el SMTP falla lo registra como fallido, avisa sin filtrar detalles y no bloquea el reintento", async () => {
      const { project } = await setup();
      fail = true;
      const err = await sendProjectReport(project.id, 30, db, deps()).catch((e) => e);
      expect(isDomainError(err) && err.code).toBe("UPSTREAM");
      expect(String(err.message)).not.toContain("535");
      const [n] = await db.select().from(s.notifications);
      expect(n).toMatchObject({ type: "report", status: "failed" });
      expect(n!.error).toContain("EAUTH");
      fail = false;
      await sendProjectReport(project.id, 30, db, deps(new Date(NOW.getTime() + 1000)));
      expect(sent).toHaveLength(1);
    });
  });
});
