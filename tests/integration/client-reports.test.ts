import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import * as s from "@/server/db/schema";
import type { Mailer, MailMessage } from "@/server/notify/mailer";
import * as repo from "@/server/repositories/client-reports";
import * as clients from "@/server/services/clients";
import { runClientReports, sendClientReport } from "@/server/services/client-reports";
import * as projects from "@/server/services/projects";

const dbUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!dbUrl)("correos automáticos al cliente", () => {
  const { db, pool } = createDb(dbUrl ?? "", 4);
  let sent: MailMessage[] = [];
  let failMail = false;
  const mailer: Mailer = {
    send: async (m) => {
      if (failMail) throw new Error("SMTP caído");
      sent.push(m);
    },
  };
  // Martes 10 de nov de 2026: la semana que se informa es del 2 al 8 de noviembre.
  let clock = new Date("2026-11-10T13:00:00Z");
  const deps = () => ({ mailer, appUrl: "https://app.test/", now: () => clock });

  beforeAll(async () => { await runMigrations(dbUrl!, "./drizzle"); });
  afterAll(() => pool.end());
  beforeEach(async () => {
    await db.execute(sql`truncate clients, settings, admin_users restart identity cascade`);
    sent = [];
    failMail = false;
    clock = new Date("2026-11-10T13:00:00Z");
  });

  async function setup(opts: { weekly?: boolean; monthly?: boolean; ga4Through?: string | null; visible?: boolean; cc?: boolean } = {}) {
    const client = await clients.createClient({ name: "Café Aurora", contactName: "Ana Ríos", contactEmail: "ana@aurora.test" }, db);
    await db
      .update(s.clients)
      .set({
        reportWeekly: opts.weekly ?? true,
        reportMonthly: opts.monthly ?? true,
        ccContacts: opts.cc === false ? [] : [{ name: "Luis Vega", email: "luis@aurora.test" }],
      })
      .where(eq(s.clients.id, client.id));
    const project = await projects.createProject(client.id, { name: "Sitio", baseUrl: "https://www.cafeaurora.test" }, db);
    await db.update(s.projects).set({ phase: "production", seoClientVisible: opts.visible ?? true, includesServer: true }).where(eq(s.projects.id, project.id));
    if (opts.ga4Through !== null) {
      await db.insert(s.seoIntegrations).values({ projectId: project.id, kind: "ga4", externalId: "123", syncStatus: "ok", syncedThrough: opts.ga4Through ?? "2026-11-09" });
    }
    return { client, project };
  }

  async function seedTraffic(projectId: string) {
    const row = (date: string, channel: string, sessions: number, page = "/") => ({ projectId, date, page, country: "col", channel, sessions, users: sessions });
    await db.insert(s.seoTrafficDaily).values([
      // semana del 2 al 8
      row("2026-11-03", "Organic Search", 610),
      row("2026-11-04", "Direct", 210),
      row("2026-11-05", "Referral", 90, "/servicios"),
      row("2026-11-05", "Organic Social", 330, "/servicios"),
      // semana anterior
      row("2026-10-28", "Organic Search", 550),
      row("2026-10-29", "Direct", 219),
      row("2026-10-30", "Referral", 75),
      row("2026-10-30", "Organic Social", 280),
    ]);
    await db.insert(s.seoSocialDaily).values([
      { projectId, date: "2026-11-05", network: "instagram", page: "/", sessions: 140, users: 100 },
      { projectId, date: "2026-11-05", network: "linkedin", page: "/", sessions: 85, users: 60 },
      { projectId, date: "2026-11-06", network: "tiktok", page: "/", sessions: 40, users: 30 },
      { projectId, date: "2026-11-06", network: "other", page: "/", sessions: 65, users: 50 },
      { projectId, date: "2026-10-29", network: "instagram", page: "/", sessions: 128, users: 90 },
      { projectId, date: "2026-10-29", network: "linkedin", page: "/", sessions: 65, users: 40 },
    ]);
    await db.insert(s.seoSearchDaily).values([
      { projectId, date: "2026-11-04", page: "/", country: "col", device: "MOBILE", clicks: 310, impressions: 9800, positionSum: 0 },
      { projectId, date: "2026-10-29", page: "/", country: "col", device: "MOBILE", clicks: 277, impressions: 9000, positionSum: 0 },
    ]);
    await db.insert(s.seoAiReferralsDaily).values({ projectId, date: "2026-11-05", source: "chatgpt.com", page: "/", sessions: 30, users: 25 });
  }

  async function seedAudits(projectId: string) {
    const [route] = await db.insert(s.routes).values({ projectId, path: "/", url: "https://www.cafeaurora.test/", monitored: true, source: "manual" }).returning();
    const audit = (profile: "mobile" | "desktop", finished: string, perf: number, seo: number, acc: number) => ({
      projectId,
      routeId: route!.id,
      profile,
      trigger: "scheduled" as const,
      phaseAtRun: "production" as const,
      status: "succeeded" as const,
      scorePerformance: perf,
      scoreSeo: seo,
      scoreAccessibility: acc,
      finishedAt: new Date(finished),
    });
    await db.insert(s.auditLogs).values([
      audit("mobile", "2026-10-05T10:00:00Z", 76, 95, 88),
      audit("mobile", "2026-10-26T10:00:00Z", 80, 95, 88), // promedio de octubre móvil: 78
      audit("desktop", "2026-10-12T10:00:00Z", 91, 96, 88),
      audit("mobile", "2026-09-14T10:00:00Z", 73, 95, 87), // septiembre móvil: 73
      audit("desktop", "2026-09-14T10:00:00Z", 89, 96, 87),
    ]);
    await db.insert(s.routes).values({ projectId, path: "/nueva", url: "https://www.cafeaurora.test/nueva", monitored: true, source: "sitemap", createdAt: new Date("2026-10-20T10:00:00Z") });
  }

  describe("semanal", () => {
    it("arma el correo con los datos reales: visitas, orígenes separados por red, IA aparte y copia al equipo", async () => {
      const { project } = await setup();
      await seedTraffic(project.id);
      const r = await sendClientReport("weekly", project.id, {}, db, deps());
      expect(r).toMatchObject({ status: "sent", to: "ana@aurora.test", cc: ["luis@aurora.test"], periodKey: "2026-W45", test: false });
      const m = sent[0]!;
      expect(m.cc).toEqual(["luis@aurora.test"]);
      // 610 + 210 + 90 + 330 = 1240 visitas frente a 550 + 219 + 75 + 280 = 1124
      expect(m.subject).toBe("Su semana en la web: 1.240 visitas (+10 %) · 2 al 8 de nov");
      expect(m.text).toContain("Hola Ana y Luis,");
      expect(m.text).toContain("Instagram: 140 (+9 %)");
      expect(m.text).toContain("TikTok: 40 (nuevo)");
      expect(m.text).not.toContain("Redes sociales (orgánico)");
      expect(m.text).toContain("Clics desde Google: 310 (+12 %)");
      expect(m.text).toContain("asistentes de IA");
      expect(m.text).toContain("1. Inicio: 820");
      expect(m.text).toContain("2. /servicios: 420");
      expect(m.text).toContain("Datos hasta el 8 de nov");
      expect(m.text).toContain("https://app.test/c/");
    });

    it("dos personas con la misma dirección: un solo correo que las nombra a las dos", async () => {
      const { project, client } = await setup({ cc: false });
      await db
        .update(s.clients)
        .set({ contactName: "Daniel Osorio", ccContacts: [{ name: "Ana María Osorio", email: "ana@aurora.test" }, { name: "Ana María Osorio", email: "ana@aurora.test" }] })
        .where(eq(s.clients.id, client.id));
      await db.update(s.clients).set({ contactEmail: "ana@aurora.test" }).where(eq(s.clients.id, client.id));
      await seedTraffic(project.id);
      await sendClientReport("weekly", project.id, {}, db, deps());
      expect(sent).toHaveLength(1);
      expect(sent[0]!.to).toBe("ana@aurora.test");
      expect(sent[0]!.cc).toBeUndefined();
      expect(sent[0]!.text).toContain("Hola Daniel y Ana María,");
      const [n] = await db.select().from(s.notifications);
      expect(n!.recipient).toBe("ana@aurora.test");
    });

    it("anota el envío y no lo repite en la misma semana", async () => {
      const { project, client } = await setup();
      await seedTraffic(project.id);
      await runClientReports(db, deps());
      const again = await runClientReports(db, deps());
      expect(sent).toHaveLength(1);
      expect(again).toMatchObject({ sent: 0, already: 1 });
      const send = await repo.findSend(db, project.id, "weekly", "2026-W45");
      expect(send).toMatchObject({ status: "sent" });
      const [n] = await db.select().from(s.notifications);
      expect(n).toMatchObject({ type: "weekly", status: "sent", clientId: client.id });
    });

    it("espera si los datos de GA4 no llegan al domingo y lo envía cuando llegan", async () => {
      const { project } = await setup({ ga4Through: "2026-11-07" });
      await seedTraffic(project.id);
      const first = await runClientReports(db, deps());
      expect(first).toMatchObject({ sent: 0, skipped: 1 });
      expect(sent).toHaveLength(0);
      expect(await repo.findSend(db, project.id, "weekly", "2026-W45")).toMatchObject({ status: "skipped" });
      expect((await repo.findSend(db, project.id, "weekly", "2026-W45"))!.detail).toContain("2026-11-07");
      await db.update(s.seoIntegrations).set({ syncedThrough: "2026-11-08" }).where(eq(s.seoIntegrations.projectId, project.id));
      clock = new Date("2026-11-11T13:00:00Z"); // miércoles, todavía dentro de la ventana
      expect(await runClientReports(db, deps())).toMatchObject({ sent: 1 });
    });

    it("no sale fuera de la ventana (jueves a domingo)", async () => {
      const { project } = await setup();
      await seedTraffic(project.id);
      clock = new Date("2026-11-12T13:00:00Z");
      expect(await runClientReports(db, deps())).toEqual({ sent: 0, skipped: 0, failed: 0, already: 0 });
      expect(sent).toHaveLength(0);
    });

    it("lo omite sin GA4, sin datos o con el tráfico oculto al cliente", async () => {
      const noGa4 = await setup({ ga4Through: null });
      await expect(sendClientReport("weekly", noGa4.project.id, { testTo: "yo@zip.test" }, db, deps())).rejects.toMatchObject({ code: "INVALID" });
      const hidden = await setup({ visible: false });
      await seedTraffic(hidden.project.id);
      await expect(sendClientReport("weekly", hidden.project.id, { testTo: "yo@zip.test" }, db, deps())).rejects.toThrow(/no está visible/);
      const empty = await setup();
      await expect(sendClientReport("weekly", empty.project.id, { testTo: "yo@zip.test" }, db, deps())).rejects.toThrow(/No hay datos de tráfico/);
      expect(sent).toHaveLength(0);
    });

    it("con muy pocas visitas habla sin porcentajes", async () => {
      const { project } = await setup();
      await db.insert(s.seoTrafficDaily).values({ projectId: project.id, date: "2026-11-03", page: "/", country: "col", channel: "Direct", sessions: 12, users: 10 });
      await sendClientReport("weekly", project.id, {}, db, deps());
      expect(sent[0]!.subject).toBe("Su semana en la web: 12 visitas · 2 al 8 de nov");
    });

    it("un fallo de SMTP se anota y se reintenta al día siguiente", async () => {
      const { project } = await setup();
      await seedTraffic(project.id);
      failMail = true;
      expect(await runClientReports(db, deps())).toMatchObject({ failed: 1 });
      expect(await repo.findSend(db, project.id, "weekly", "2026-W45")).toMatchObject({ status: "failed" });
      failMail = false;
      clock = new Date("2026-11-11T13:00:00Z");
      expect(await runClientReports(db, deps())).toMatchObject({ sent: 1 });
      expect(await repo.findSend(db, project.id, "weekly", "2026-W45")).toMatchObject({ status: "sent" });
    });

    it("solo envía a los clientes que lo tienen encendido y están activos", async () => {
      const off = await setup({ weekly: false, monthly: false });
      await seedTraffic(off.project.id);
      const suspended = await setup();
      await seedTraffic(suspended.project.id);
      await db.update(s.clients).set({ status: "suspended" }).where(eq(s.clients.id, suspended.client.id));
      expect(await runClientReports(db, deps())).toEqual({ sent: 0, skipped: 0, failed: 0, already: 0 });
    });

    it("la prueba va solo al administrador y no deja rastro", async () => {
      const { project } = await setup();
      await seedTraffic(project.id);
      const r = await sendClientReport("weekly", project.id, { testTo: "yo@zip.test" }, db, deps());
      expect(r).toMatchObject({ status: "sent", to: "yo@zip.test", cc: [], test: true });
      expect(sent[0]!.cc).toBeUndefined();
      expect(sent[0]!.subject.startsWith("[PRUEBA] ")).toBe(true);
      expect(await repo.findSend(db, project.id, "weekly", "2026-W45")).toBeUndefined();
      expect(await db.select().from(s.notifications)).toHaveLength(0);
    });
  });

  describe("mensual", () => {
    beforeEach(() => {
      clock = new Date("2026-11-02T13:00:00Z"); // primer lunes de noviembre: se informa octubre
    });

    it("promedia las auditorías del mes, compara con el anterior y cuenta lo atendido", async () => {
      const { project } = await setup({ weekly: false });
      await seedAudits(project.id);
      await repo.insertAction(db, { projectId: project.id, happenedOn: "2026-10-14", text: "Actualicé un componente." });
      await repo.insertAction(db, { projectId: project.id, happenedOn: "2026-09-30", text: "Fuera del mes." });
      await repo.setServerCheck(db, project.id, "2026-10", clock);
      const r = await sendClientReport("monthly", project.id, {}, db, deps());
      expect(r).toMatchObject({ status: "sent", periodKey: "2026-10" });
      const m = sent[0]!;
      expect(m.subject).toBe("cafeaurora.test: octubre en orden. Rendimiento móvil 78 (+5)");
      expect(m.text).toContain("Rendimiento: móvil 78 (+5), escritorio 91 (+2)");
      expect(m.text).toContain("Visibilidad (SEO): móvil 95 (sin cambio), escritorio 96 (sin cambio)");
      expect(m.text).toContain("Mejoró la velocidad en el móvil este mes");
      expect(m.text).toContain("14 oct: Actualicé un componente.");
      expect(m.text).not.toContain("Fuera del mes");
      expect(m.text).toContain("Servidor y servicios: supervisados durante todo el mes");
      expect(m.text).toContain("1 página nueva en octubre");
      expect(m.text).toContain("Hola Ana y Luis,");
      expect(m.text).toContain("/informe");
    });

    it("no afirma que el servidor está bien si no lo confirmaste", async () => {
      const { project } = await setup({ weekly: false });
      await seedAudits(project.id);
      await runClientReports(db, deps());
      expect(sent[0]!.text).not.toContain("Servidor y servicios");
    });

    it("sin actuaciones dice que no hizo falta intervenir", async () => {
      const { project } = await setup({ weekly: false });
      await seedAudits(project.id);
      await sendClientReport("monthly", project.id, {}, db, deps());
      expect(sent[0]!.text).toContain("Este mes no hizo falta intervenir");
    });

    it("una alerta abierta cambia el tono y el asunto", async () => {
      const { project } = await setup({ weekly: false });
      await seedAudits(project.id);
      const [route] = await db.select().from(s.routes).where(eq(s.routes.projectId, project.id)).limit(1);
      await db.insert(s.alertStates).values({ projectId: project.id, routeId: route!.id, profile: "mobile", kind: "audit_failure", status: "open" });
      await sendClientReport("monthly", project.id, {}, db, deps());
      expect(sent[0]!.subject.startsWith("cafeaurora.test: resumen de octubre.")).toBe(true);
      expect(sent[0]!.text).toContain("Hay un punto en revisión");
    });

    it("sin auditorías del mes no se envía y deja el motivo", async () => {
      const { project } = await setup({ weekly: false });
      expect(await runClientReports(db, deps())).toMatchObject({ sent: 0, skipped: 1 });
      expect((await repo.findSend(db, project.id, "monthly", "2026-10"))!.detail).toContain("No hubo auditorías");
    });

    it("sale el primer lunes y no otro día del mes", async () => {
      const { project } = await setup({ weekly: false });
      await seedAudits(project.id);
      clock = new Date("2026-11-09T13:00:00Z");
      expect(await runClientReports(db, deps())).toEqual({ sent: 0, skipped: 0, failed: 0, already: 0 });
      clock = new Date("2026-11-02T13:00:00Z");
      expect(await runClientReports(db, deps())).toMatchObject({ sent: 1 });
      expect(await runClientReports(db, deps())).toMatchObject({ sent: 0, already: 1 });
      expect(await repo.findSend(db, project.id, "monthly", "2026-10")).toMatchObject({ status: "sent" });
    });
  });

  describe("registro de actuaciones", () => {
    it("guarda, lista y borra solo las del proyecto", async () => {
      const a = await setup();
      const b = await setup();
      await repo.insertAction(db, { projectId: a.project.id, happenedOn: "2026-10-14", text: "Uno" });
      await repo.insertAction(db, { projectId: a.project.id, happenedOn: "2026-10-20", text: "Dos" });
      const list = await repo.listRecentActions(db, a.project.id, 10);
      expect(list.map((x) => x.text)).toEqual(["Dos", "Uno"]);
      expect(await repo.deleteAction(db, b.project.id, list[0]!.id)).toBe(false);
      expect(await repo.deleteAction(db, a.project.id, list[0]!.id)).toBe(true);
      expect(await repo.listRecentActions(db, a.project.id, 10)).toHaveLength(1);
    });
    it("la revisión del servidor se confirma una vez por mes", async () => {
      const { project } = await setup();
      expect(await repo.hasServerCheck(db, project.id, "2026-10")).toBe(false);
      await repo.setServerCheck(db, project.id, "2026-10", new Date("2026-10-31T10:00:00Z"));
      await repo.setServerCheck(db, project.id, "2026-10", new Date("2026-11-01T10:00:00Z"));
      expect(await repo.hasServerCheck(db, project.id, "2026-10")).toBe(true);
      expect(await repo.listServerChecks(db, project.id, 5)).toEqual(["2026-10"]);
    });
  });
});
