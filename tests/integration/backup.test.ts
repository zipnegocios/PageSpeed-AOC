import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import { Queue } from "bullmq";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFakeS3, type FakeS3 } from "../helpers/fake-s3";
import { BACKUP_TABLES, encodeRow } from "@/server/backup/format";
import { parseBackup, restoreBackup, RestoreError } from "@/server/backup/restore";
import { BACKUP_PREFIX } from "@/server/backup/retention";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import * as s from "@/server/db/schema";
import { createRedis, QUEUE_PREFIX } from "@/server/queue/connection";
import { MAINTENANCE_QUEUE } from "@/server/queue/queues";
import { getBackupStatus, requestBackupNow, runBackup } from "@/server/services/backups";
import * as alerts from "@/server/services/alerts";
import * as clients from "@/server/services/clients";
import * as projects from "@/server/services/projects";
import * as routes from "@/server/services/routes";
import { createApiKey } from "@/server/services/api-keys";
import { createR2, type R2Store } from "@/server/storage/r2";

const gunzipAsync = promisify(gunzip);
const gzipAsync = promisify(gzip);
const dbUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
const DAY = 86_400_000;
const NOW = new Date("2026-11-03T03:17:00Z");

describe.skipIf(!dbUrl)("respaldos de Postgres a R2", () => {
  const { db, pool } = createDb(dbUrl ?? "", 4);
  let s3: FakeS3;
  let r2: R2Store;

  beforeAll(async () => {
    await runMigrations(dbUrl!, "./drizzle");
    s3 = await startFakeS3();
    r2 = createR2({ endpoint: s3.url, region: "auto", bucket: "reportes", accessKeyId: "ak", secretAccessKey: "sk" });
  });
  afterAll(async () => {
    r2.destroy();
    await s3.close();
    await pool.end();
  });
  beforeEach(async () => {
    await db.execute(sql`truncate clients, settings, admin_users, admin_invites, mcp_api_keys restart identity cascade`);
    s3.objects.clear();
    s3.mtimes.clear();
    s3.failWith(null);
  });

  /** Datos de todas las tablas, con fechas, binarios, numéricos, arreglos y JSON. */
  async function seed() {
    const client = await clients.createClient({ name: "Acme", contactName: "Ana", contactEmail: "ana@acme.test", contactPhone: "+57 300 123 4567", notes: "ñandú\ncon salto" }, db);
    const project = await projects.createProject(client.id, { name: "Tienda", baseUrl: "https://acme.test" }, db);
    await db.update(s.projects).set({ phase: "production", authConfigEnc: Buffer.from([1, 2, 3, 250]) }).where(eq(s.projects.id, project.id));
    const home = await routes.addRoute(project.id, { path: "/" }, db);
    const [a] = await db
      .insert(s.auditLogs)
      .values({
        projectId: project.id, routeId: home.id, profile: "mobile", trigger: "scheduled", phaseAtRun: "production", status: "succeeded",
        scorePerformance: 61, scoreSeo: 69, scoreAccessibility: 100, scoreBestPractices: 96, lcpMs: 4100, cls: "0.1234", tbtMs: 200,
        r2Key: "acme/tienda/x.json.gz", finishedAt: new Date("2026-10-30T10:00:00.456Z"), durationMs: 21000,
      })
      .returning();
    await alerts.evaluateAudit(a!.id, { db });
    await alerts.sweepNotifications({ db, mailer: { send: async () => undefined }, recipient: "a@x.test", appUrl: "https://app.test", now: () => new Date("2026-10-30T10:05:00Z") });
    await createApiKey({ name: "agente", preset: "read", access: "all" }, db);
    await db.insert(s.adminUsers).values({ email: "admin@x.test", passwordHash: "scrypt$hash", role: "owner" });
    await db.insert(s.adminInvites).values({ email: "luis@x.test", kind: "invite", tokenHash: "h".repeat(64), expiresAt: new Date("2026-11-10T00:00:00.789Z") });
    await db.insert(s.settings).values({ key: "default_thresholds", value: { performance: 80, seo: 90 } });
    return { client, project, home };
  }

  /** Foto exacta de todas las tablas, para comparar antes y después. */
  async function snapshot(): Promise<Record<string, string[]>> {
    const out: Record<string, string[]> = {};
    for (const { name, table, order } of BACKUP_TABLES) {
      const rows = await db.select().from(table).orderBy(...order);
      out[name] = rows.map((r) => encodeRow(r));
    }
    return out;
  }

  const wipe = () => db.execute(sql`truncate clients, settings, admin_users, admin_invites, mcp_api_keys restart identity cascade`);

  describe("exportación", () => {
    it("sube un archivo comprimido a R2 bajo su propio prefijo y lo registra", async () => {
      await seed();
      const done = await runBackup({ db, r2, now: () => NOW });
      expect(done.key).toBe("_backups/postgres/2026/11/pagespeed-20261103T031700Z.ndjson.gz");
      expect(s3.objects.has(done.key)).toBe(true);
      expect(done.bytes).toBe(s3.objects.get(done.key)!.length);
      expect(done.rows).toBeGreaterThan(8);

      const text = (await gunzipAsync(s3.objects.get(done.key)!)).toString("utf8");
      const lines = text.split("\n");
      expect(JSON.parse(lines[0]!)).toMatchObject({ _: "pagespeed-backup", format: 1 });
      expect(JSON.parse(lines.at(-1)!)).toMatchObject({ _: "end" });
      expect(lines.slice(1, -1).every((l) => l.startsWith('{"t":"'))).toBe(true);

      const status = await getBackupStatus({ db, r2, now: () => new Date(NOW.getTime() + 3_600_000) });
      expect(status.last).toMatchObject({ key: done.key, bytes: done.bytes });
      expect(status.stale).toBe(false);
      expect(status.recent!.map((o) => o.key)).toEqual([done.key]);
    });

    it("sin respaldos o con uno de hace más de 36 horas el estado es desactualizado", async () => {
      expect((await getBackupStatus({ db, r2, now: () => NOW })).stale).toBe(true);
      await runBackup({ db, r2, now: () => NOW });
      expect((await getBackupStatus({ db, r2, now: () => new Date(NOW.getTime() + 35 * 3_600_000) })).stale).toBe(false);
      expect((await getBackupStatus({ db, r2, now: () => new Date(NOW.getTime() + 37 * 3_600_000) })).stale).toBe(true);
    });

    it("si R2 rechaza la subida lo anota, lo relanza y el panel puede mostrarlo", async () => {
      s3.failWith(403);
      await expect(runBackup({ db, r2, now: () => NOW })).rejects.toThrow();
      const status = await getBackupStatus({ db, r2, now: () => NOW });
      expect(status.last).toBeNull();
      expect(status.lastError?.at).toBe(NOW.toISOString());
      expect(status.lastError!.message.length).toBeGreaterThan(0);
      // Un respaldo posterior correcto limpia el error.
      s3.failWith(null);
      await runBackup({ db, r2, now: () => NOW });
      expect((await getBackupStatus({ db, r2, now: () => NOW })).lastError).toBeNull();
    });

    it("aplica la retención: borra lo viejo y conserva los más recientes", async () => {
      for (const d of [100, 90, 80, 70, 60, 50, 40]) {
        const key = `${BACKUP_PREFIX}2026/07/pagespeed-viejo-${d}.ndjson.gz`;
        s3.objects.set(key, Buffer.from("x"));
        s3.mtimes.set(key, new Date(NOW.getTime() - d * DAY));
      }
      const stray = `${BACKUP_PREFIX}notas.txt`;
      s3.objects.set(stray, Buffer.from("x"));
      s3.mtimes.set(stray, new Date(NOW.getTime() - 500 * DAY));
      const done = await runBackup({ db, r2, now: () => NOW });
      expect(done.pruned).toBe(3); // 100, 90 y 80: quedan el nuevo + 4 viejos
      const left = [...s3.objects.keys()].filter((k) => k.endsWith(".ndjson.gz")).sort();
      expect(left).toHaveLength(5);
      expect(left).toContain(done.key);
      expect(s3.objects.has(stray)).toBe(true); // lo ajeno no se toca
    });
  });

  describe("ida y vuelta", () => {
    it("restaurar en una base nueva deja todas las tablas idénticas, byte a byte", async () => {
      await seed();
      const before = await snapshot();
      expect(Object.values(before).every((rows, i) => rows.length > 0 || BACKUP_TABLES[i]!.name === "routes")).toBe(true);
      const done = await runBackup({ db, r2, now: () => NOW });
      const after0 = await snapshot(); // el respaldo anota last_backup en settings
      expect((after0.settings ?? []).length).toBe((before.settings ?? []).length + 1);

      await wipe();
      // Una base recién desplegada ya trae al administrador del primer arranque: el respaldo manda.
      await db.insert(s.adminUsers).values({ email: "otro@x.test", passwordHash: "otro" });
      const result = await restoreBackup(db, s3.objects.get(done.key)!);
      expect(result.rows).toBeGreaterThan(8);

      const restored = await snapshot();
      const backedUp = await parseBackup(s3.objects.get(done.key)!);
      for (const { name } of BACKUP_TABLES) {
        // lo restaurado es exactamente lo que había al hacer el respaldo (settings aún sin last_backup)
        const expected = before[name] ?? [];
        const got = name === "settings" ? (restored.settings ?? []).filter((r) => !r.includes('"last_backup"')) : (restored[name] ?? []);
        expect(got, name).toEqual(expected);
        expect(backedUp.rows.get(name)!.length, name).toBe(expected.length);
      }
      expect((restored.admin_users ?? []).some((r) => r.includes("otro@x.test"))).toBe(false);
    });

    it("conserva los binarios, las fechas con milisegundos y los numéricos", async () => {
      const { project } = await seed();
      const done = await runBackup({ db, r2, now: () => NOW });
      await wipe();
      await restoreBackup(db, s3.objects.get(done.key)!);
      const [p] = await db.select().from(s.projects).where(eq(s.projects.id, project.id));
      expect([...p!.authConfigEnc!]).toEqual([1, 2, 3, 250]);
      const [a] = await db.select().from(s.auditLogs);
      expect(a!.finishedAt!.toISOString()).toBe("2026-10-30T10:00:00.456Z");
      expect(a!.cls).toBe("0.1234");
      const [n] = await db.select().from(s.notifications);
      expect(n!.alertStateIds.length).toBeGreaterThan(0);
    });
  });

  describe("restauración segura", () => {
    it("se niega a mezclar datos con una base que ya tiene clientes", async () => {
      await seed();
      const done = await runBackup({ db, r2, now: () => NOW });
      const before = await snapshot();
      const err = await restoreBackup(db, s3.objects.get(done.key)!).catch((e) => e);
      expect(err).toBeInstanceOf(RestoreError);
      expect(String(err.message)).toContain("no está vacía");
      expect(await snapshot()).toEqual(before);
    });

    it("rechaza archivos que no son respaldos, incompletos, dañados o de otro formato", async () => {
      await seed();
      const done = await runBackup({ db, r2, now: () => NOW });
      const lines = (await gunzipAsync(s3.objects.get(done.key)!)).toString("utf8").split("\n");
      const pack = (ls: string[]) => gzipAsync(Buffer.from(ls.join("\n")));

      await expect(parseBackup(Buffer.from("no es gzip"))).rejects.toThrow(/descomprimir/);
      await expect(parseBackup(await gzipAsync(Buffer.from('{"hola":1}\n')))).rejects.toThrow(/no es un respaldo/);
      await expect(parseBackup(await pack(lines.slice(0, -1)))).rejects.toThrow(/incompleto/); // sin pie
      const wrongFormat = [JSON.stringify({ ...JSON.parse(lines[0]!), format: 99 }), ...lines.slice(1)];
      await expect(parseBackup(await pack(wrongFormat))).rejects.toThrow(/Formato de respaldo 99/);
      const missingRow = lines.filter((l, i) => i !== 1);
      await expect(parseBackup(await pack(missingRow))).rejects.toThrow(/dañado/);
      const alien = [lines[0]!, '{"t":"tabla_inventada","r":{}}', ...lines.slice(1)];
      await expect(parseBackup(await pack(alien))).rejects.toThrow(/desconocida/);
    });

    it("si algo falla a mitad no queda nada a medias", async () => {
      await seed();
      const done = await runBackup({ db, r2, now: () => NOW });
      const lines = (await gunzipAsync(s3.objects.get(done.key)!)).toString("utf8").split("\n");
      // Duplica una fila de audit_logs (la última tabla grande): la clave primaria rechaza la inserción.
      const idx = lines.findIndex((l) => l.startsWith('{"t":"audit_logs"'));
      const footer = JSON.parse(lines.at(-1)!);
      footer.counts.audit_logs += 1;
      const broken = [...lines.slice(0, idx + 1), lines[idx]!, ...lines.slice(idx + 1, -1), JSON.stringify(footer)];
      await wipe();
      await expect(restoreBackup(db, await gzipAsync(Buffer.from(broken.join("\n"))))).rejects.toThrow();
      for (const { name, table } of BACKUP_TABLES) {
        if (name === "settings" || name === "admin_users") continue;
        expect((await db.select().from(table)).length, name).toBe(0);
      }
    });
  });

  describe.skipIf(!redisUrl)("respaldo a demanda", () => {
    it("pide el respaldo una sola vez mientras esté pendiente", async () => {
      const redis = createRedis(redisUrl!);
      const queue = new Queue(MAINTENANCE_QUEUE, { connection: redis, prefix: QUEUE_PREFIX });
      try {
        await queue.obliterate({ force: true });
        expect(await requestBackupNow({ queue })).toEqual({ queued: true });
        expect(await requestBackupNow({ queue })).toEqual({ queued: false });
        expect((await queue.getJob("backup-manual"))?.name).toBe("backup");
      } finally {
        await queue.obliterate({ force: true });
        await queue.close();
        await redis.quit();
      }
    });
  });
});
