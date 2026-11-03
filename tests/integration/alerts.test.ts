import pino from "pino";
import { eq, sql } from "drizzle-orm";
import type { Job } from "bullmq";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fixture from "../fixtures/lhr-minimal.json";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import * as s from "@/server/db/schema";
import type { Mailer, MailMessage } from "@/server/notify/mailer";
import { suppressOpenAlerts } from "@/server/repositories/projects";
import * as alerts from "@/server/services/alerts";
import * as clients from "@/server/services/clients";
import * as projects from "@/server/services/projects";
import * as routes from "@/server/services/routes";
import * as thresholds from "@/server/services/thresholds";
import type { LighthouseRunner } from "@/worker/lighthouse/runner";
import { createAuditProcessor } from "@/worker/processors/audit.processor";

const dbUrl = process.env.TEST_DATABASE_URL;
const DAY = 86_400_000;
const T0 = new Date("2026-03-01T10:00:00Z");
const at = (ms: number) => () => new Date(T0.getTime() + ms);

type Scores = { p?: number; s?: number; a?: number; b?: number };

describe.skipIf(!dbUrl)("alertas: evaluación, envío agrupado y recordatorios", () => {
  const { db, pool } = createDb(dbUrl ?? "", 4);
  const sent: MailMessage[] = [];
  let failNext = 0;
  const mailer: Mailer = {
    async send(m) {
      if (failNext > 0) {
        failNext--;
        throw Object.assign(new Error("Connection refused"), { code: "ECONNREFUSED" });
      }
      sent.push(m);
    },
  };

  beforeAll(async () => {
    await runMigrations(dbUrl!, "./drizzle");
  });
  afterAll(() => pool.end());
  beforeEach(async () => {
    await db.execute(sql`truncate clients, settings, admin_users restart identity cascade`);
    sent.length = 0;
    failNext = 0;
  });

  /** Proyecto en producción con rutas (se evita el agendador de Redis: se cambia la fase por SQL). */
  async function setup(paths = ["/"], contact: { contactName?: string; contactPhone?: string } = {}) {
    const client = await clients.createClient({ name: "Acme", ...contact }, db);
    const project = await projects.createProject(client.id, { name: "Tienda", baseUrl: "https://acme.test" }, db);
    await db.update(s.projects).set({ phase: "production" }).where(eq(s.projects.id, project.id));
    const created = [];
    for (const path of paths) created.push(await routes.addRoute(project.id, { path }, db));
    return { client, project, routes: created };
  }

  async function audit(
    projectId: string,
    routeId: string,
    profile: "mobile" | "desktop",
    scores: Scores | "failed",
    opts: { phase?: "development" | "production"; status?: "queued" | "running" } = {},
  ) {
    const failed = scores === "failed";
    const [row] = await db
      .insert(s.auditLogs)
      .values({
        projectId,
        routeId,
        profile,
        trigger: "scheduled",
        phaseAtRun: opts.phase ?? "production",
        status: opts.status ?? (failed ? "failed" : "succeeded"),
        errorCode: failed ? "TIMEOUT" : null,
        scorePerformance: failed ? null : (scores.p ?? 100),
        scoreSeo: failed ? null : (scores.s ?? 100),
        scoreAccessibility: failed ? null : (scores.a ?? 100),
        scoreBestPractices: failed ? null : (scores.b ?? 100),
        r2Key: failed ? null : "k",
        finishedAt: new Date(),
      })
      .returning();
    return row!;
  }

  const states = () => db.select().from(s.alertStates).orderBy(s.alertStates.openedAt);
  const open = async () => (await states()).filter((x) => x.status === "open");
  const sweep = (ms: number, extra: Partial<Parameters<typeof alerts.sweepNotifications>[0]> = {}) =>
    alerts.sweepNotifications({ db, mailer, recipient: "admin@x.test", appUrl: "https://app.test/", now: at(ms), ...extra });

  describe("evaluateAudit", () => {
    it("abre una alerta por cada métrica bajo su umbral, guardando valor y umbral", async () => {
      const { project, routes: [r] } = await setup();
      const a = await audit(project.id, r!.id, "mobile", { p: 70, s: 69 });
      expect(await alerts.evaluateAudit(a.id, { db, now: at(0) })).toEqual({ opened: 2, resolved: 0 });
      const rows = await open();
      expect(rows.map((x) => [x.metric, x.lastValue, x.thresholdAtOpen, x.profile, x.openedByAuditId]).sort()).toEqual([
        ["performance", 70, 80, "mobile", a.id],
        ["seo", 69, 90, "mobile", a.id],
      ]);
    });

    it("no repite mientras siga igual, pero actualiza el último valor", async () => {
      const { project, routes: [r] } = await setup();
      await alerts.evaluateAudit((await audit(project.id, r!.id, "mobile", { s: 69 })).id, { db });
      const again = await alerts.evaluateAudit((await audit(project.id, r!.id, "mobile", { s: 60 })).id, { db });
      expect(again).toEqual({ opened: 0, resolved: 0 });
      const rows = await open();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ lastValue: 60, thresholdAtOpen: 90 });
    });

    it("se resuelve al recuperarse y una nueva caída es una alerta nueva", async () => {
      const { project, routes: [r] } = await setup();
      await alerts.evaluateAudit((await audit(project.id, r!.id, "mobile", { s: 69 })).id, { db, now: at(0) });
      const good = await audit(project.id, r!.id, "mobile", { s: 95 });
      expect(await alerts.evaluateAudit(good.id, { db, now: at(DAY) })).toEqual({ opened: 0, resolved: 1 });
      expect(await open()).toHaveLength(0);
      await alerts.evaluateAudit((await audit(project.id, r!.id, "mobile", { s: 70 })).id, { db, now: at(2 * DAY) });
      const all = await states();
      expect(all.map((x) => x.status)).toEqual(["resolved", "open"]);
      expect(all[0]).toMatchObject({ resolvedByAuditId: good.id, lastValue: 95 });
    });

    it("un puntaje exactamente igual al umbral cumple", async () => {
      const { project, routes: [r] } = await setup();
      await alerts.evaluateAudit((await audit(project.id, r!.id, "mobile", { p: 80, s: 90 })).id, { db });
      expect(await open()).toHaveLength(0);
    });

    it("móvil y escritorio tienen alertas independientes", async () => {
      const { project, routes: [r] } = await setup();
      await alerts.evaluateAudit((await audit(project.id, r!.id, "mobile", { s: 60 })).id, { db });
      await alerts.evaluateAudit((await audit(project.id, r!.id, "desktop", { s: 99 })).id, { db });
      expect((await open()).map((x) => x.profile)).toEqual(["mobile"]);
    });

    it("un umbral desactivado no alerta y cierra la alerta que hubiera", async () => {
      const { project, routes: [r] } = await setup();
      await alerts.evaluateAudit((await audit(project.id, r!.id, "mobile", { s: 60 })).id, { db });
      await thresholds.setThresholds(project.id, [{ metric: "seo", minScore: 90, enabled: false }], db);
      const out = await alerts.evaluateAudit((await audit(project.id, r!.id, "mobile", { s: 60 })).id, { db });
      expect(out.resolved).toBe(1);
      expect(await open()).toHaveLength(0);
    });

    it("el umbral del proyecto manda (no el de la fase de creación)", async () => {
      const { project, routes: [r] } = await setup();
      await thresholds.setThresholds(project.id, [{ metric: "seo", minScore: 50, enabled: true }], db);
      await alerts.evaluateAudit((await audit(project.id, r!.id, "mobile", { s: 69 })).id, { db });
      expect(await open()).toHaveLength(0);
    });

    it("en desarrollo no se evalúa nada", async () => {
      const { project, routes: [r] } = await setup();
      const a = await audit(project.id, r!.id, "mobile", { s: 10 }, { phase: "development" });
      expect(await alerts.evaluateAudit(a.id, { db })).toEqual({ opened: 0, resolved: 0 });
      await db.update(s.projects).set({ phase: "development" }).where(eq(s.projects.id, project.id));
      const b = await audit(project.id, r!.id, "desktop", { s: 10 });
      expect(await alerts.evaluateAudit(b.id, { db })).toEqual({ opened: 0, resolved: 0 });
      expect(await states()).toHaveLength(0);
    });

    it("ignora auditorías que no existen o no terminaron bien", async () => {
      const { project, routes: [r] } = await setup();
      expect(await alerts.evaluateAudit("00000000-0000-4000-8000-000000000000", { db })).toEqual({ opened: 0, resolved: 0 });
      const failed = await audit(project.id, r!.id, "mobile", "failed");
      expect(await alerts.evaluateAudit(failed.id, { db })).toEqual({ opened: 0, resolved: 0 });
    });
  });

  describe("evaluateFailure", () => {
    it("abre un fallo de auditoría, no lo duplica y lo resuelve un éxito posterior", async () => {
      const { project, routes: [r] } = await setup();
      const f1 = await audit(project.id, r!.id, "mobile", "failed");
      expect(await alerts.evaluateFailure(f1.id, { db })).toEqual({ opened: 1, resolved: 0 });
      const f2 = await audit(project.id, r!.id, "mobile", "failed");
      expect(await alerts.evaluateFailure(f2.id, { db })).toEqual({ opened: 0, resolved: 0 });
      expect(await open()).toHaveLength(1);
      expect((await open())[0]).toMatchObject({ kind: "audit_failure", metric: null, openedByAuditId: f1.id });

      const ok = await audit(project.id, r!.id, "mobile", {});
      expect(await alerts.evaluateAudit(ok.id, { db })).toEqual({ opened: 0, resolved: 1 });
      expect(await open()).toHaveLength(0);
    });

    it("no actúa en desarrollo ni sobre auditorías que no fallaron", async () => {
      const { project, routes: [r] } = await setup();
      const dev = await audit(project.id, r!.id, "mobile", "failed", { phase: "development" });
      expect(await alerts.evaluateFailure(dev.id, { db })).toEqual({ opened: 0, resolved: 0 });
      const ok = await audit(project.id, r!.id, "desktop", {});
      expect(await alerts.evaluateFailure(ok.id, { db })).toEqual({ opened: 0, resolved: 0 });
    });
  });

  describe("sweepNotifications", () => {
    it("manda un solo correo por proyecto con todo lo abierto, y lo registra", async () => {
      const { project, routes: [r1, r2] } = await setup(["/", "/blog"]);
      await alerts.evaluateAudit((await audit(project.id, r1!.id, "mobile", { p: 70, s: 69 })).id, { db, now: at(0) });
      await alerts.evaluateAudit((await audit(project.id, r2!.id, "desktop", { s: 50 })).id, { db, now: at(0) });
      await alerts.evaluateFailure((await audit(project.id, r2!.id, "mobile", "failed")).id, { db, now: at(0) });

      const out = await sweep(60_000);
      expect(out).toMatchObject({ sent: 4, failed: 0, waiting: 0 });
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ to: "admin@x.test" });
      expect(sent[0]!.subject).toContain("Tienda");
      expect(sent[0]!.text).toContain("SEO 69 (mínimo 90)");
      expect(sent[0]!.text).toContain("/blog · Escritorio: SEO 50");
      expect(sent[0]!.text).toContain("la auditoría falla (TIMEOUT)");
      expect(sent[0]!.text).toContain(`https://app.test/admin/proyectos/${project.id}`);

      const log = await db.select().from(s.notifications);
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({ type: "initial", status: "sent", recipient: "admin@x.test", projectId: project.id });
      expect(log[0]!.alertStateIds).toHaveLength(4);
      expect((await open()).every((x) => x.lastNotifiedAt?.getTime() === T0.getTime() + 60_000 && x.reminderCount === 0)).toBe(true);
    });

    it("no vuelve a avisar hasta pasados 7 días; entonces recuerda y cuenta el recordatorio", async () => {
      const { project, routes: [r] } = await setup();
      await alerts.evaluateAudit((await audit(project.id, r!.id, "mobile", { s: 69 })).id, { db, now: at(0) });
      await sweep(0);
      expect(sent).toHaveLength(1);

      expect((await sweep(DAY)).sent).toBe(0);
      expect((await sweep(7 * DAY - 1)).sent).toBe(0);
      expect(sent).toHaveLength(1);

      expect((await sweep(7 * DAY)).sent).toBe(1);
      expect(sent).toHaveLength(2);
      expect(sent[1]!.subject).toMatch(/^Recordatorio/);
      expect(sent[1]!.text).toContain("recordatorio n.º 1");
      expect((await open())[0]).toMatchObject({ reminderCount: 1 });
      expect((await db.select().from(s.notifications)).map((n) => n.type)).toEqual(expect.arrayContaining(["initial", "reminder"]));

      // El siguiente recordatorio es 7 días después del último aviso, no del primero.
      expect((await sweep(13 * DAY)).sent).toBe(0);
      expect((await sweep(14 * DAY)).sent).toBe(1);
      expect(sent[2]!.text).toContain("recordatorio n.º 2");
      expect((await open())[0]!.reminderCount).toBe(2);
    });

    it("caída → recordatorio → recuperación → nueva caída: sin correo de recuperación y con aviso nuevo", async () => {
      const { project, routes: [r] } = await setup();
      await alerts.evaluateAudit((await audit(project.id, r!.id, "mobile", { s: 69 })).id, { db, now: at(0) });
      await sweep(0);
      await sweep(7 * DAY);
      expect(sent).toHaveLength(2);

      await alerts.evaluateAudit((await audit(project.id, r!.id, "mobile", { s: 95 })).id, { db, now: at(8 * DAY) });
      await sweep(8 * DAY);
      await sweep(20 * DAY);
      expect(sent).toHaveLength(2); // recuperada: ni recuerda ni avisa de la recuperación

      await alerts.evaluateAudit((await audit(project.id, r!.id, "mobile", { s: 72 })).id, { db, now: at(21 * DAY) });
      await sweep(21 * DAY);
      expect(sent).toHaveLength(3);
      expect(sent[2]!.subject).toMatch(/^Alerta en /);
    });

    it("el correo de un proyecto espera a que terminen sus auditorías pendientes", async () => {
      const { project, routes: [r1, r2] } = await setup(["/", "/otra"]);
      await alerts.evaluateAudit((await audit(project.id, r1!.id, "mobile", { s: 60 })).id, { db, now: at(0) });
      const queued = await audit(project.id, r2!.id, "mobile", {}, { status: "queued" });
      await db.update(s.auditLogs).set({ queuedAt: at(0)() }).where(eq(s.auditLogs.id, queued.id));

      expect(await sweep(60_000)).toMatchObject({ sent: 0, waiting: 1 });
      expect(sent).toHaveLength(0);

      await db.update(s.auditLogs).set({ status: "succeeded" }).where(eq(s.auditLogs.id, queued.id));
      await alerts.evaluateAudit(queued.id, { db, now: at(120_000) });
      await alerts.evaluateAudit((await audit(project.id, r2!.id, "desktop", { s: 40 })).id, { db, now: at(120_000) });
      expect(await sweep(180_000)).toMatchObject({ sent: 2, waiting: 0 });
      expect(sent).toHaveLength(1);
    });

    it("una auditoría atascada en cola desde hace horas no retrasa el correo para siempre", async () => {
      const { project, routes: [r1, r2] } = await setup(["/", "/otra"]);
      await alerts.evaluateAudit((await audit(project.id, r1!.id, "mobile", { s: 60 })).id, { db, now: at(0) });
      const stuck = await audit(project.id, r2!.id, "mobile", {}, { status: "queued" });
      await db.update(s.auditLogs).set({ queuedAt: at(0)() }).where(eq(s.auditLogs.id, stuck.id));
      expect((await sweep(4 * 3_600_000)).sent).toBe(1);
    });

    it("si el envío falla lo registra, no marca el aviso y reintenta pasada la espera", async () => {
      const { project, routes: [r] } = await setup();
      await alerts.evaluateAudit((await audit(project.id, r!.id, "mobile", { s: 69 })).id, { db, now: at(0) });
      failNext = 1;
      expect(await sweep(0)).toMatchObject({ sent: 0, failed: 1 });
      const [n] = await db.select().from(s.notifications);
      expect(n).toMatchObject({ status: "failed", type: "initial" });
      expect(n!.error).toContain("ECONNREFUSED");
      expect((await open())[0]!.lastNotifiedAt).toBeNull();

      expect(await sweep(5 * 60_000)).toMatchObject({ sent: 0, skipped: 1 }); // aún en espera
      expect(sent).toHaveLength(0);
      expect(await sweep(61 * 60_000)).toMatchObject({ sent: 1 });
      expect(sent).toHaveLength(1);
    });

    it("sin SMTP configurado no envía ni marca nada", async () => {
      const { project, routes: [r] } = await setup();
      await alerts.evaluateAudit((await audit(project.id, r!.id, "mobile", { s: 69 })).id, { db, now: at(0) });
      const out = await alerts.sweepNotifications({ db, mailer: null, recipient: "a@x.test", appUrl: "https://app.test", now: at(0) });
      expect(out).toMatchObject({ sent: 0, skipped: 1 });
      expect((await open())[0]!.lastNotifiedAt).toBeNull();
      expect(await db.select().from(s.notifications)).toHaveLength(0);
    });

    it("las alertas silenciadas por pasar a desarrollo no se envían", async () => {
      const { project, routes: [r] } = await setup();
      await alerts.evaluateAudit((await audit(project.id, r!.id, "mobile", { s: 69 })).id, { db, now: at(0) });
      expect(await suppressOpenAlerts(db, project.id)).toBe(1);
      expect((await sweep(DAY)).sent).toBe(0);
      expect(sent).toHaveLength(0);
    });

    it("proyectos distintos reciben correos distintos", async () => {
      const a = await setup(["/"]);
      const client = await clients.createClient({ name: "Otro" }, db);
      const p2 = await projects.createProject(client.id, { name: "Blog", baseUrl: "https://otro.test" }, db);
      await db.update(s.projects).set({ phase: "production" }).where(eq(s.projects.id, p2.id));
      const r2 = await routes.addRoute(p2.id, { path: "/" }, db);
      await alerts.evaluateAudit((await audit(a.project.id, a.routes[0]!.id, "mobile", { s: 60 })).id, { db, now: at(0) });
      await alerts.evaluateAudit((await audit(p2.id, r2.id, "mobile", { s: 60 })).id, { db, now: at(0) });
      await sweep(0);
      expect(sent.map((m) => m.subject).sort()).toEqual([expect.stringContaining("Blog"), expect.stringContaining("Tienda")]);
    });
  });

  describe("destinatario, lectura y WhatsApp", () => {
    it("ALERT_EMAIL manda sobre el correo del administrador", async () => {
      expect(await alerts.resolveAlertRecipient(undefined, db)).toBeNull();
      await db.insert(s.adminUsers).values({ email: "admin@x.test", passwordHash: "h" });
      expect(await alerts.resolveAlertRecipient(undefined, db)).toBe("admin@x.test");
      expect(await alerts.resolveAlertRecipient("alertas@x.test", db)).toBe("alertas@x.test");
    });

    it("lista las alertas abiertas con un resumen legible y filtra por proyecto", async () => {
      const { project, routes: [r] } = await setup();
      await alerts.evaluateAudit((await audit(project.id, r!.id, "mobile", { s: 69 })).id, { db });
      await alerts.evaluateFailure((await audit(project.id, r!.id, "desktop", "failed")).id, { db });
      const list = await alerts.listOpenAlerts(project.id, db);
      expect(list.map((a) => a.summary).sort()).toEqual(["SEO 69 (mínimo 90)", "la auditoría falla (TIMEOUT)"]);
      expect(await alerts.listOpenAlerts(undefined, db)).toHaveLength(2);
    });

    it("arma el enlace de WhatsApp con el teléfono y lo detectado; null sin teléfono o sin alertas", async () => {
      const { project, routes: [r] } = await setup(["/"], { contactName: "Ana", contactPhone: "+57 300 123 4567" });
      expect(await alerts.getWhatsappLinkForProject(project.id, db)).toBeNull(); // sin alertas
      await alerts.evaluateAudit((await audit(project.id, r!.id, "mobile", { s: 69 })).id, { db });
      const link = (await alerts.getWhatsappLinkForProject(project.id, db))!;
      expect(link.startsWith("https://wa.me/573001234567?text=")).toBe(true);
      const text = decodeURIComponent(link.split("?text=")[1]!);
      expect(text).toContain("Hola Ana");
      expect(text).toContain("*Tienda*");
      expect(text).toContain("/: SEO 69/100 (móvil)");

      const none = await setup(["/"]);
      await alerts.evaluateAudit((await audit(none.project.id, none.routes[0]!.id, "mobile", { s: 69 })).id, { db });
      expect(await alerts.getWhatsappLinkForProject(none.project.id, db)).toBeNull(); // sin teléfono
    });
  });

  describe("enganche en el procesador de auditorías", () => {
    const log = pino({ level: "silent" });
    const runner: LighthouseRunner = async () => ({ lhr: structuredClone(fixture) as never });
    const r2 = { putAuditJson: async () => ({ bytes: 1 }) };

    async function run(opts: { alerts: NonNullable<Parameters<typeof createAuditProcessor>[0]["alerts"]>; runner?: LighthouseRunner }) {
      const { project, routes: [r] } = await setup();
      const row = await db
        .insert(s.auditLogs)
        .values({ projectId: project.id, routeId: r!.id, profile: "mobile", trigger: "manual", phaseAtRun: "production" })
        .returning()
        .then((x) => x[0]!);
      const process = createAuditProcessor({
        db, r2, runner: opts.runner ?? runner, log, timeoutMs: 1000, cooldownMs: 0, allowPrivate: true, sleep: async () => {},
        resolver: async () => [{ address: "93.184.216.34", family: 4 }],
        alerts: opts.alerts,
      });
      const job = { id: row.id, data: { auditId: row.id }, attemptsMade: 0, opts: { attempts: 1 } } as unknown as Job<{ auditId: string }>;
      const result = await process(job as never).then(() => "ok", (e: Error) => e.message);
      const [after] = await db.select().from(s.auditLogs).where(eq(s.auditLogs.id, row.id));
      return { result, after: after!, id: row.id };
    }

    it("evalúa las alertas tras una auditoría correcta", async () => {
      const calls: string[] = [];
      const { after, id } = await run({
        alerts: { evaluateAudit: async (i) => (calls.push(`ok:${i}`), { opened: 0, resolved: 0 }), evaluateFailure: async () => ({ opened: 0, resolved: 0 }) },
      });
      expect(after.status).toBe("succeeded");
      expect(calls).toEqual([`ok:${id}`]);
    });

    it("un error al evaluar las alertas no cambia el resultado de la auditoría", async () => {
      const { result, after } = await run({
        alerts: { evaluateAudit: async () => { throw new Error("bd caída"); }, evaluateFailure: async () => ({ opened: 0, resolved: 0 }) },
      });
      expect(result).toBe("ok");
      expect(after.status).toBe("succeeded");
    });

    it("evalúa el fallo tras agotar los intentos", async () => {
      const calls: string[] = [];
      const { after, id } = await run({
        runner: async () => { throw new Error("boom"); },
        alerts: { evaluateAudit: async () => ({ opened: 0, resolved: 0 }), evaluateFailure: async (i) => (calls.push(`fail:${i}`), { opened: 1, resolved: 0 }) },
      });
      expect(after.status).toBe("failed");
      expect(calls).toEqual([`fail:${id}`]);
    });
  });
});
