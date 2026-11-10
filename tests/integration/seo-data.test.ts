import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import * as s from "@/server/db/schema";
import { isDomainError } from "@/server/domain/errors";
import { addDays } from "@/server/domain/seo-data";
import * as clients from "@/server/services/clients";
import * as projects from "@/server/services/projects";
import { getSeoDashboard } from "@/server/services/seo-data";

const dbUrl = process.env.TEST_DATABASE_URL;

/** Último día con datos de las pruebas. Los demás se calculan a partir de él. */
const END = "2026-06-30";
const day = (offset: number) => addDays(END, offset);

describe.skipIf(!dbUrl)("datos de búsqueda y tráfico (SEO)", () => {
  const { db, pool } = createDb(dbUrl ?? "", 4);
  let projectId: string;
  let otherId: string;

  beforeAll(async () => {
    await runMigrations(dbUrl!, "./drizzle");
  });
  afterAll(() => pool.end());
  beforeEach(async () => {
    await db.execute(sql`truncate clients, settings restart identity cascade`);
    const client = await clients.createClient({ name: "Acme" }, db);
    projectId = (await projects.createProject(client.id, { name: "Tienda", baseUrl: "https://acme.test" }, db)).id;
    otherId = (await projects.createProject(client.id, { name: "Blog", baseUrl: "https://blog.acme.test" }, db)).id;
  });

  const search = (project: string, date: string, page: string, country: string, device: string, clicks: number, impressions: number, positionSum: number) =>
    db.insert(s.seoSearchDaily).values({ projectId: project, date, page, country, device, clicks, impressions, positionSum });
  const traffic = (project: string, date: string, page: string, country: string, channel: string, sessions: number, users: number) =>
    db.insert(s.seoTrafficDaily).values({ projectId: project, date, page, country, channel, sessions, users });
  const social = (project: string, date: string, network: string, page: string, sessions: number, users: number) =>
    db.insert(s.seoSocialDaily).values({ projectId: project, date, network, page, sessions, users });
  const ai = (project: string, date: string, source: string, page: string, sessions: number, users: number) =>
    db.insert(s.seoAiReferralsDaily).values({ projectId: project, date, source, page, sessions, users });

  it("sin datos: rango nulo, secciones nulas y estado de descarga según las conexiones", async () => {
    expect(await getSeoDashboard(projectId, { days: 28 }, db)).toEqual({ range: null, previous: null, sync: { gsc: null, ga4: null }, markets: [], lang: null, languages: null, search: null, traffic: null, social: null, ai: null });

    await db.insert(s.seoIntegrations).values([
      { projectId, kind: "gsc", externalId: "sc-domain:acme.test", syncStatus: "ok", syncedThrough: "2026-06-29", lastSyncAt: new Date("2026-06-30T10:00:00Z"), syncDetail: "Descargados 12 días." },
      { projectId, kind: "ga4", externalId: "123", syncStatus: "error", syncDetail: "Sin permiso en la propiedad." },
    ]);
    const d = await getSeoDashboard(projectId, { days: 7 }, db);
    expect(d.range).toBeNull();
    expect(d.sync.gsc).toEqual({ status: "ok", syncedThrough: "2026-06-29", lastSyncAt: new Date("2026-06-30T10:00:00Z"), detail: "Descargados 12 días." });
    expect(d.sync.ga4).toEqual({ status: "error", syncedThrough: null, lastSyncAt: null, detail: "Sin permiso en la propiedad." });
  });

  it("el rango termina en el último día con datos de cualquiera de las tres tablas", async () => {
    await search(projectId, day(-3), "/a", "col", "MOBILE", 1, 10, 10);
    await traffic(projectId, day(-1), "/a", "Colombia", "Organic Search", 4, 3);
    await ai(projectId, day(-2), "chatgpt.com", "/a", 1, 1);
    const d = await getSeoDashboard(projectId, { days: 7 }, db);
    expect(d.range).toEqual({ from: day(-7), to: day(-1), days: 7 });
    expect(d.previous).toEqual({ from: day(-14), to: day(-8) });
  });

  it("cada fuente termina en su último día con datos: Search Console, que cierra con retraso, no muestra ceros al final ni compara menos días", async () => {
    // Search Console llega hasta day(-3); GA4, hasta day(-1).
    for (let i = -20; i <= -3; i++) await search(projectId, day(i), "/a", "col", "MOBILE", 10, 100, 400);
    for (let i = -20; i <= -1; i++) await traffic(projectId, day(i), "/a", "Colombia", "Direct", 5, 4);
    await ai(projectId, day(-1), "chatgpt.com", "/a", 2, 2);

    const d = await getSeoDashboard(projectId, { days: 7 }, db);
    expect(d.range).toEqual({ from: day(-7), to: day(-1), days: 7 });

    expect(d.search!.range).toEqual({ from: day(-9), to: day(-3), days: 7 });
    expect(d.search!.previous).toEqual({ from: day(-16), to: day(-10), days: 7 });
    expect(d.search!.daily).toHaveLength(7);
    expect(d.search!.daily.at(-1)).toEqual({ date: day(-3), clicks: 10, impressions: 100 });
    expect(d.search!.daily.every((p) => p.clicks === 10)).toBe(true);
    // Ambos periodos suman 7 días de datos: sin variación artificial.
    expect(d.search!.totals.clicks).toBe(70);
    expect(d.search!.previousTotals.clicks).toBe(70);

    expect(d.traffic!.range).toEqual({ from: day(-7), to: day(-1), days: 7 });
    expect(d.traffic!.daily.at(-1)).toEqual({ date: day(-1), sessions: 5 });
    expect(d.traffic!.totals.sessions).toBe(35);
    expect(d.traffic!.previousTotals.sessions).toBe(35);
    expect(d.ai!.range).toEqual(d.traffic!.range);
  });

  describe("con datos sembrados", () => {
    beforeEach(async () => {
      // Search Console: dos páginas, tres países, dos dispositivos.
      await search(projectId, day(0), "/es/precios", "col", "MOBILE", 10, 100, 200); // posición 2
      await search(projectId, day(0), "/es/precios", "col", "DESKTOP", 5, 300, 1800); // posición 6
      await search(projectId, day(0), "/es/blog", "usa", "MOBILE", 20, 50, 500);
      await search(projectId, day(-6), "/es/blog", "esp", "DESKTOP", 7, 70, 140);
      await search(projectId, day(-7), "/es/blog", "xyz", "TABLET", 3, 30, 30); // fuera de 7 días, dentro de 28
      await search(projectId, day(-30), "/es/blog", "col", "MOBILE", 8, 80, 80); // periodo anterior de 28 días
      await search(projectId, day(-100), "/es/blog", "col", "MOBILE", 999, 999, 999); // fuera de 90 días
      // GA4.
      await traffic(projectId, day(0), "/es/precios", "Colombia", "Organic Search", 30, 20);
      await traffic(projectId, day(0), "/es/precios", "Colombia", "Direct", 10, 8);
      await traffic(projectId, day(-2), "/es/blog", "United States", "Organic Search", 15, 12);
      await traffic(projectId, day(-30), "/es/blog", "Colombia", "Organic Search", 11, 9);
      // Visitas desde IA.
      await ai(projectId, day(0), "chatgpt.com", "/es/precios", 6, 5);
      await ai(projectId, day(-1), "perplexity.ai", "/es/blog", 2, 2);
      await ai(projectId, day(-1), "chatgpt.com", "/es/blog", 3, 3);
      await ai(projectId, day(-30), "chatgpt.com", "/es/blog", 1, 1);
      // Redes sociales.
      await social(projectId, day(0), "instagram", "/es/blog", 8, 6);
      await social(projectId, day(-1), "facebook", "/es/precios", 5, 4);
      await social(projectId, day(-1), "instagram", "/es/precios", 3, 3);
      await social(projectId, day(-2), "other", "/es/blog", 1, 1);
      await social(projectId, day(-30), "facebook", "/es/blog", 4, 4);
    });

    it("redes sociales: totales, por red con su nombre, páginas de entrada y comparación con el periodo anterior", async () => {
      const d = await getSeoDashboard(projectId, { days: 7 }, db);
      expect(d.social!.totals).toEqual({ sessions: 17, users: 14 });
      expect(d.social!.byNetwork).toEqual([
        { network: "instagram", label: "Instagram", sessions: 11 },
        { network: "facebook", label: "Facebook", sessions: 5 },
        { network: "other", label: "Otras redes", sessions: 1 },
      ]);
      expect(d.social!.topPages.map((p) => [p.page, p.sessions])).toEqual([["/es/blog", 9], ["/es/precios", 8]]);
      expect(d.social!.range).toEqual(d.traffic!.range);
      // El periodo anterior (días -13 a -7) está vacío en 7 días; con 90 días entra el día -30 (facebook).
      const d90 = await getSeoDashboard(projectId, { days: 90 }, db);
      expect(d90.social!.totals.sessions).toBe(21);
    });

    it("el filtro de idioma también acota las redes sociales por página", async () => {
      const d = await getSeoDashboard(projectId, { days: 28, lang: "es" }, db);
      expect(d.social).not.toBeNull();
    });

    it("periodo de 7 días: totales, CTR y posición ponderada por impresiones", async () => {
      const d = await getSeoDashboard(projectId, { days: 7 }, db);
      expect(d.range).toEqual({ from: day(-6), to: END, days: 7 });
      expect(d.search!.totals.clicks).toBe(42);
      expect(d.search!.totals.impressions).toBe(520);
      expect(d.search!.totals.ctr).toBeCloseTo(42 / 520, 10);
      // (200 + 1800 + 500 + 140) / 520: pondera por impresiones, no promedia las posiciones de cada fila.
      expect(d.search!.totals.position).toBeCloseTo(2640 / 520, 10);
      expect(d.traffic!.totals).toEqual({ sessions: 55, users: 40 });
      expect(d.ai!.totals).toEqual({ sessions: 11, users: 10 });
    });

    it("periodos de 28 y 90 días incluyen más filas y excluyen las de fuera", async () => {
      const d28 = await getSeoDashboard(projectId, { days: 28 }, db);
      expect(d28.range!.days).toBe(28);
      expect(d28.search!.totals.clicks).toBe(45);
      expect(d28.search!.daily).toHaveLength(28);

      const d90 = await getSeoDashboard(projectId, { days: 90 }, db);
      expect(d90.search!.totals.clicks).toBe(53); // suma el día -30 pero no el -100
      expect(d90.search!.daily).toHaveLength(90);
      expect(d90.traffic!.totals.sessions).toBe(66);
      expect(d90.ai!.totals.sessions).toBe(12);
    });

    it("compara con el periodo anterior de igual longitud", async () => {
      const d7 = await getSeoDashboard(projectId, { days: 7 }, db);
      expect(d7.previous).toEqual({ from: day(-13), to: day(-7) });
      expect(d7.search!.previousTotals).toMatchObject({ clicks: 3, impressions: 30 });
      expect(d7.search!.previousTotals.position).toBe(1);
      expect(d7.traffic!.previousTotals).toEqual({ sessions: 0, users: 0 });

      const d28 = await getSeoDashboard(projectId, { days: 28 }, db);
      expect(d28.previous).toEqual({ from: day(-55), to: day(-28) });
      expect(d28.search!.previousTotals).toMatchObject({ clicks: 8, impressions: 80, position: 1 });
      expect(d28.traffic!.previousTotals).toEqual({ sessions: 11, users: 9 });
      expect(d28.ai!.previousTotals).toEqual({ sessions: 1, users: 1 });
    });

    it("la serie diaria rellena con ceros los días sin datos", async () => {
      const { daily } = (await getSeoDashboard(projectId, { days: 7 }, db)).search!;
      expect(daily.map((p) => p.date)).toEqual([-6, -5, -4, -3, -2, -1, 0].map(day));
      expect(daily.map((p) => p.clicks)).toEqual([7, 0, 0, 0, 0, 0, 35]);
      expect(daily.map((p) => p.impressions)).toEqual([70, 0, 0, 0, 0, 0, 450]);
      const t = (await getSeoDashboard(projectId, { days: 7 }, db)).traffic!.daily;
      expect(t.map((p) => p.sessions)).toEqual([0, 0, 0, 0, 15, 0, 40]);
    });

    it("páginas principales por clics, con CTR y posición ponderada", async () => {
      const { topPages } = (await getSeoDashboard(projectId, { days: 7 }, db)).search!;
      expect(topPages.map((p) => p.page)).toEqual(["/es/blog", "/es/precios"]);
      expect(topPages[0]).toMatchObject({ page: "/es/blog", clicks: 27, impressions: 120 });
      expect(topPages[0]!.position).toBeCloseTo(640 / 120, 10);
      expect(topPages[1]).toMatchObject({ page: "/es/precios", clicks: 15, impressions: 400 });
      expect(topPages[1]!.ctr).toBeCloseTo(15 / 400, 10);
      expect(topPages[1]!.position).toBeCloseTo(5, 10);
    });

    it("limita los rankings: 10 páginas, 8 países", async () => {
      for (let i = 0; i < 12; i++) await search(projectId, day(-1), `/p${i}`, `c${String(i).padStart(2, "0")}`, "MOBILE", 100 - i, 100, 100);
      const { topPages, countries } = (await getSeoDashboard(projectId, { days: 7 }, db)).search!;
      expect(topPages).toHaveLength(10);
      expect(topPages[0]!.page).toBe("/p0");
      expect(countries).toHaveLength(8);
      expect(countries[0]!.country).toBe("c00");
    });

    it("países con su nombre en español (y el código en mayúsculas si no se conoce) y dispositivos con etiqueta", async () => {
      const { countries, devices } = (await getSeoDashboard(projectId, { days: 28 }, db)).search!;
      expect(countries.map((c) => [c.country, c.name, c.clicks])).toEqual([
        ["usa", "Estados Unidos", 20],
        ["col", "Colombia", 15],
        ["esp", "España", 7],
        ["xyz", "XYZ", 3],
      ]);
      expect(devices.map((x) => [x.device, x.label, x.clicks])).toEqual([
        ["MOBILE", "Móvil", 30],
        ["DESKTOP", "Escritorio", 12],
        ["TABLET", "Tableta", 3],
      ]);
    });

    it("tráfico: canales, páginas y países de GA4 ordenados por sesiones", async () => {
      const t = (await getSeoDashboard(projectId, { days: 7 }, db)).traffic!;
      expect(t.channels).toEqual([
        { channel: "Organic Search", sessions: 45 },
        { channel: "Direct", sessions: 10 },
      ]);
      expect(t.topPages).toEqual([
        { page: "/es/precios", sessions: 40, users: 28 },
        { page: "/es/blog", sessions: 15, users: 12 },
      ]);
      expect(t.countries).toEqual([
        { country: "Colombia", sessions: 40 },
        { country: "Estados Unidos", sessions: 15 },
      ]);
    });

    it("visitas desde IA: por fuente y páginas de entrada", async () => {
      const a = (await getSeoDashboard(projectId, { days: 7 }, db)).ai!;
      expect(a.bySource).toEqual([
        { source: "chatgpt.com", sessions: 9 },
        { source: "perplexity.ai", sessions: 2 },
      ]);
      expect(a.topPages).toEqual([
        { page: "/es/precios", sessions: 6 },
        { page: "/es/blog", sessions: 5 },
      ]);
    });

    it("una sección sin filas en el periodo es nula aunque haya datos de otras fuentes", async () => {
      await db.execute(sql`delete from seo_ai_referrals_daily`);
      await db.execute(sql`delete from seo_traffic_daily`);
      const d = await getSeoDashboard(projectId, { days: 7 }, db);
      expect(d.search).not.toBeNull();
      expect(d.traffic).toBeNull();
      expect(d.ai).toBeNull();
    });

    it("no mezcla proyectos", async () => {
      await search(otherId, day(0), "/otro", "mex", "MOBILE", 5000, 9000, 9000);
      await traffic(otherId, day(0), "/otro", "Mexico", "Referral", 777, 700);
      await ai(otherId, day(0), "gemini.google.com", "/otro", 33, 30);
      await db.insert(s.seoIntegrations).values({ projectId: otherId, kind: "gsc", externalId: "sc-domain:blog.test", syncStatus: "ok" });

      const mine = await getSeoDashboard(projectId, { days: 7 }, db);
      expect(mine.search!.totals.clicks).toBe(42);
      expect(mine.search!.topPages.map((p) => p.page)).not.toContain("/otro");
      expect(mine.traffic!.channels.map((c) => c.channel)).not.toContain("Referral");
      expect(mine.ai!.bySource.map((x) => x.source)).not.toContain("gemini.google.com");
      expect(mine.sync.gsc).toBeNull();

      const theirs = await getSeoDashboard(otherId, { days: 7 }, db);
      expect(theirs.search!.totals).toMatchObject({ clicks: 5000, impressions: 9000 });
      expect(theirs.search!.topPages).toHaveLength(1);
      expect(theirs.traffic!.totals.sessions).toBe(777);
      expect(theirs.sync.gsc?.status).toBe("ok");
    });
  });

  it("rechaza un identificador de proyecto que no es un UUID y devuelve vacío para uno que no existe", async () => {
    const err = await getSeoDashboard("no-es-uuid", { days: 28 }, db).catch((e: unknown) => e);
    expect(isDomainError(err) && err.code).toBe("NOT_FOUND");
    expect((await getSeoDashboard(randomUUID(), { days: 28 }, db)).range).toBeNull();
  });

  it("rechaza periodos que no son de 1 a 366 días enteros", async () => {
    for (const days of [0, -1, 2.5, 400, Number.NaN]) {
      const err = await getSeoDashboard(projectId, { days }, db).catch((e: unknown) => e);
      expect(isDomainError(err) && err.code).toBe("INVALID");
    }
  });
});
