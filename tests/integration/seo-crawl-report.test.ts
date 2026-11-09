import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import * as s from "@/server/db/schema";
import type { PageRow } from "@/server/domain/seo-crawl-rows";
import type { Issue } from "@/server/domain/seo-crawl-rules";
import * as repo from "@/server/repositories/seo-crawl";
import * as clients from "@/server/services/clients";
import * as projects from "@/server/services/projects";
import { getCrawlReport } from "@/server/services/seo-crawl";
import { addMarket } from "@/server/services/seo-markets";

const dbUrl = process.env.TEST_DATABASE_URL;
const OK = { status: "succeeded" as const, outcome: "complete", detail: null, pagesCrawled: 3, pagesDiscovered: 3, requests: 9, truncatedBy: null };
const page = (path: string): PageRow => ({ path, status: 200, finalPath: null, hops: 0, loop: false, contentType: "text/html", blockedByRobots: false, inSitemap: true, lang: null, title: "T", descriptionLength: 1, h1Count: 1, canonical: path, htmlLang: "es", robots: null, hreflang: null, jsonLdTypes: null, inlinks: 0 });
const issue = (code: Issue["code"], pg: string, severity: Issue["severity"], lang: string | null = null, evidence: Issue["evidence"] = {}): Issue => ({ code, page: pg, severity, lang, evidence });

describe.skipIf(!dbUrl)("informe del rastreo técnico", () => {
  const { db, pool } = createDb(dbUrl ?? "", 4);
  let a: string;
  let b: string;

  beforeAll(async () => {
    await runMigrations(dbUrl!, "./drizzle");
  });
  afterAll(() => pool.end());
  beforeEach(async () => {
    await db.execute(sql`truncate clients, settings restart identity cascade`);
    const client = await clients.createClient({ name: "Acme" }, db);
    a = (await projects.createProject(client.id, { name: "Tienda", baseUrl: "https://acme.test" }, db)).id;
    b = (await projects.createProject(client.id, { name: "Blog", baseUrl: "https://blog.acme.test" }, db)).id;
    await addMarket(a, { lang: "es", prefix: "", isDefault: true }, db);
    await addMarket(a, { lang: "en", prefix: "/en", isDefault: false }, db);
  });

  async function finished(projectId: string, minutesAgo: number, issues: Issue[], status: "succeeded" | "partial" | "failed" = "succeeded") {
    const run = await repo.createRun(db, projectId, "manual");
    await db.update(s.seoCrawlRuns).set({ queuedAt: new Date(Date.now() - minutesAgo * 60_000) }).where(eq(s.seoCrawlRuns.id, run.id));
    await repo.markRunning(db, run.id, {});
    await repo.finishRun(db, run.id, { ...OK, status, outcome: status === "failed" ? "unreachable" : "complete", detail: status === "failed" ? "No responde" : null }, [page("/")], issues);
    return run.id;
  }

  const before = [
    issue("status_error", "/gone", "error", "es"),
    issue("title_missing", "/a", "error", "es"),
    issue("h1_missing", "/a", "warning", "es"),
    issue("h1_missing", "/en/x", "warning", "en"),
    issue("robots_missing", "", "warning"),
  ];
  const now = [
    issue("title_missing", "/a", "error", "es"), // persiste
    issue("title_missing", "/b", "error", "es", {}), // nuevo
    issue("h1_missing", "/a", "warning", "es"), // persiste
    issue("h1_missing", "/b", "warning", "es"), // nuevo
    issue("h1_missing", "/en/x", "warning", "en"), // persiste
    issue("client_rendered", "/spa", "info", null), // nuevo
  ];

  it("sin ningún rastreo, todo vacío", async () => {
    const r = await getCrawlReport(a, {}, db);
    expect(r).toMatchObject({ active: null, latest: null, current: null, previous: null, counts: null, changes: null, groups: [], detail: null, history: [], lang: null });
    expect(r.markets.map((m) => m.lang)).toEqual(["es", "en"]);
  });

  it("con un rastreo en cola, lo marca como activo y no inventa números", async () => {
    const run = await repo.createRun(db, a, "manual");
    const r = await getCrawlReport(a, {}, db);
    expect(r.active?.id).toBe(run.id);
    expect(r.latest?.status).toBe("queued");
    expect(r.current).toBeNull();
    expect(r.counts).toBeNull();
  });

  it("con un solo rastreo terminado hay números pero no comparación", async () => {
    await finished(a, 10, now);
    const r = await getCrawlReport(a, {}, db);
    expect(r.current?.status).toBe("succeeded");
    expect(r.previous).toBeNull();
    expect(r.counts).toEqual({ error: 2, warning: 3, info: 1 });
    expect(r.previousCounts).toBeNull();
    expect(r.changes).toBeNull();
    expect(r.groups.every((g) => g.added === 0)).toBe(true);
  });

  it("compara con el rastreo anterior: nuevos y resueltos, y agrupa de más a menos grave", async () => {
    await finished(a, 100, before);
    await finished(a, 10, now);
    const r = await getCrawlReport(a, {}, db);
    expect(r.counts).toEqual({ error: 2, warning: 3, info: 1 });
    expect(r.previousCounts).toEqual({ error: 2, warning: 3, info: 0 });
    // Nuevos: title_missing /b, h1_missing /b, client_rendered /spa. Resueltos: status_error /gone y robots_missing del sitio.
    expect(r.changes).toEqual({ added: 3, resolved: 2 });
    expect(r.groups.map((g) => [g.code, g.severity, g.pages, g.added])).toEqual([
      ["title_missing", "error", 2, 1],
      ["h1_missing", "warning", 3, 1],
      ["client_rendered", "info", 1, 1],
    ]);
    expect(r.groups[0]).toMatchObject({ title: "Sin título", group: "contenido" });
    expect(r.groups[0]!.advice.length).toBeGreaterThan(10);
    expect(r.history.map((h) => [h.errors, h.warnings, h.infos])).toEqual([[2, 3, 0], [2, 3, 1]]);
  });

  it("el idioma filtra números, grupos y comparación; uno inválido se ignora; los del sitio solo salen sin filtro", async () => {
    await finished(a, 100, before);
    await finished(a, 10, now);
    const en = await getCrawlReport(a, { lang: "en" }, db);
    expect(en.lang).toBe("en");
    expect(en.counts).toEqual({ error: 0, warning: 1, info: 0 });
    expect(en.previousCounts).toEqual({ error: 0, warning: 1, info: 0 });
    expect(en.changes).toEqual({ added: 0, resolved: 0 });
    expect(en.groups.map((g) => g.code)).toEqual(["h1_missing"]);
    const es = await getCrawlReport(a, { lang: "es" }, db);
    expect(es.changes).toEqual({ added: 2, resolved: 1 });
    expect((await getCrawlReport(a, { lang: "fr" }, db)).lang).toBeNull();
    expect((await getCrawlReport(a, { lang: "none" }, db)).lang).toBeNull();
    expect((await getCrawlReport(a, {}, db)).previousCounts).toMatchObject({ warning: 3 });
  });

  it("el detalle de un hallazgo lista sus páginas con la evidencia y marca las nuevas", async () => {
    await finished(a, 100, before);
    await finished(a, 10, [...now.slice(0, 5), issue("h1_missing", "/c", "warning", "es", { count: 0 })]);
    const r = await getCrawlReport(a, { code: "h1_missing" }, db);
    expect(r.detail).toMatchObject({ code: "h1_missing", severity: "warning", title: "Sin h1", more: 0 });
    expect(r.detail!.rows.map((x) => [x.page, x.isNew])).toEqual([["/a", false], ["/b", true], ["/c", true], ["/en/x", false]]);
    // Un código inexistente, o sin filas en este rastreo, no abre detalle.
    expect((await getCrawlReport(a, { code: "no_existe" }, db)).detail).toBeNull();
    expect((await getCrawlReport(a, { code: "status_error" }, db)).detail).toBeNull();
    // El detalle respeta el idioma.
    expect((await getCrawlReport(a, { code: "h1_missing", lang: "en" }, db)).detail!.rows.map((x) => x.page)).toEqual(["/en/x"]);
  });

  it("limita las filas del detalle y dice cuántas faltan", async () => {
    const many = Array.from({ length: 250 }, (_, i) => issue("h1_missing", `/p${String(i).padStart(3, "0")}`, "warning", "es"));
    await finished(a, 10, many);
    const r = await getCrawlReport(a, { code: "h1_missing" }, db);
    expect(r.detail!.rows).toHaveLength(200);
    expect(r.detail!.more).toBe(50);
    expect(r.groups[0]!.pages).toBe(250);
  });

  it("si el último rastreo falló, los números siguen siendo los del último terminado y el fallo se ve aparte", async () => {
    await finished(a, 100, now);
    await finished(a, 10, [], "failed");
    const r = await getCrawlReport(a, {}, db);
    expect(r.latest).toMatchObject({ status: "failed", outcome: "unreachable", detail: "No responde" });
    expect(r.current?.status).toBe("succeeded");
    expect(r.counts).toEqual({ error: 2, warning: 3, info: 1 });
    expect(r.previous).toBeNull();
  });

  it("un rastreo parcial cuenta como terminado y conserva por qué se cortó", async () => {
    const run = await repo.createRun(db, a, "scheduled");
    await repo.markRunning(db, run.id, {});
    await repo.finishRun(db, run.id, { ...OK, status: "partial", outcome: "partial", truncatedBy: "pages", detail: "Se alcanzó el máximo de 300 páginas" }, [page("/")], now);
    const r = await getCrawlReport(a, {}, db);
    expect(r.current).toMatchObject({ status: "partial", truncatedBy: "pages", trigger: "scheduled", detail: "Se alcanzó el máximo de 300 páginas" });
  });

  it("no mezcla proyectos y rechaza identificadores inválidos", async () => {
    await finished(a, 10, now);
    const other = await getCrawlReport(b, {}, db);
    expect(other.current).toBeNull();
    expect(other.groups).toEqual([]);
    await expect(getCrawlReport("no-uuid", {}, db)).rejects.toThrow(/Proyecto no encontrado/);
  });
});
