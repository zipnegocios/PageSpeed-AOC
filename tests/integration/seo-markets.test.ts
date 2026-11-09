import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import * as s from "@/server/db/schema";
import { addDays } from "@/server/domain/seo-data";
import * as clients from "@/server/services/clients";
import * as projects from "@/server/services/projects";
import { getSeoDashboard } from "@/server/services/seo-data";
import { addMarket, getMarketSuggestions, getMarkets, removeMarket } from "@/server/services/seo-markets";

const dbUrl = process.env.TEST_DATABASE_URL;
const END = "2026-06-30";
const day = (offset: number) => addDays(END, offset);

describe.skipIf(!dbUrl)("idiomas del sitio (SEO)", () => {
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

  const search = (project: string, date: string, page: string, clicks: number, impressions = clicks * 10) =>
    db.insert(s.seoSearchDaily).values({ projectId: project, date, page, country: "col", device: "MOBILE", clicks, impressions, positionSum: impressions * 3 });
  const traffic = (project: string, date: string, page: string, sessions: number) =>
    db.insert(s.seoTrafficDaily).values({ projectId: project, date, page, country: "Colombia", channel: "Organic Search", sessions, users: sessions });
  const ai = (project: string, date: string, page: string, sessions: number) =>
    db.insert(s.seoAiReferralsDaily).values({ projectId: project, date, source: "chatgpt.com", page, sessions, users: sessions });

  describe("declarar idiomas", () => {
    it("guarda idioma y prefijo, normaliza lo escrito y devuelve primero el idioma por defecto", async () => {
      await addMarket(projectId, { lang: "EN", prefix: "en/", isDefault: false }, db);
      await addMarket(projectId, { lang: "pt", prefix: "https://acme.test/pt/", isDefault: false }, db);
      await addMarket(projectId, { lang: "es", prefix: "/ignorado", isDefault: true }, db);
      expect(await getMarkets(projectId, db)).toEqual([
        { lang: "es", prefix: "/", isDefault: true, label: "Español" },
        { lang: "en", prefix: "/en", isDefault: false, label: "Inglés" },
        { lang: "pt", prefix: "/pt", isDefault: false, label: "Portugués" },
      ]);
    });

    it("rechaza repetidos, un segundo idioma por defecto y entradas inválidas con mensajes claros", async () => {
      await addMarket(projectId, { lang: "es", prefix: "", isDefault: true }, db);
      await addMarket(projectId, { lang: "en", prefix: "/en", isDefault: false }, db);
      await expect(addMarket(projectId, { lang: "en", prefix: "/english", isDefault: false }, db)).rejects.toThrow(/idioma ya está declarado/);
      await expect(addMarket(projectId, { lang: "pt", prefix: "/en", isDefault: false }, db)).rejects.toThrow(/prefijo ya lo usa/);
      await expect(addMarket(projectId, { lang: "pt", prefix: "", isDefault: true }, db)).rejects.toThrow(/idioma por defecto/);
      await expect(addMarket(projectId, { lang: "pt", prefix: "", isDefault: false }, db)).rejects.toThrow(/Indica el prefijo/);
      await expect(addMarket(projectId, { lang: "es-MX", prefix: "/mx", isDefault: false }, db)).rejects.toThrow(/sin el país/);
      await expect(addMarket(projectId, { lang: "fr", prefix: "/a/b/c", isDefault: false }, db)).rejects.toThrow(/como \/es o \/en/);
      await expect(addMarket("no-uuid", { lang: "fr", prefix: "/fr", isDefault: false }, db)).rejects.toThrow(/Proyecto no encontrado/);
      await expect(addMarket("0198a1b2-0000-7000-8000-000000000000", { lang: "fr", prefix: "/fr", isDefault: false }, db)).rejects.toThrow(/Proyecto no encontrado/);
      expect(await getMarkets(projectId, db)).toHaveLength(2);
    });

    it("cada proyecto tiene los suyos, se pueden quitar y se borran con el proyecto", async () => {
      await addMarket(projectId, { lang: "en", prefix: "/en", isDefault: false }, db);
      await addMarket(otherId, { lang: "en", prefix: "/en", isDefault: false }, db);
      await removeMarket(projectId, "en", db);
      expect(await getMarkets(projectId, db)).toEqual([]);
      expect(await getMarkets(otherId, db)).toHaveLength(1);
      await expect(removeMarket(projectId, "en", db)).rejects.toThrow(/no está declarado/);
      await db.delete(s.projects).where(eq(s.projects.id, otherId));
      expect(await db.select().from(s.seoMarkets)).toHaveLength(0);
    });
  });

  describe("sugerencias a partir de los datos", () => {
    it("propone los prefijos de idioma que aparecen en las rutas, con su peso, sin los ya declarados", async () => {
      await search(projectId, day(0), "/es/precios", 10);
      await search(projectId, day(0), "/en/services", 20);
      await search(projectId, day(0), "/pt-br/precos", 3);
      await search(projectId, day(0), "/blog/post", 50);
      await search(projectId, day(0), "/faq/envios", 40);
      await search(projectId, day(0), "/", 99);
      await traffic(projectId, day(0), "/en/services", 7);
      await traffic(projectId, day(0), "/fr/contact", 4);
      await search(otherId, day(0), "/de/preise", 500);

      expect(await getMarketSuggestions(projectId, db)).toEqual([
        { prefix: "/en", lang: "en", label: "Inglés", clicks: 20, sessions: 7 },
        { prefix: "/es", lang: "es", label: "Español", clicks: 10, sessions: 0 },
        { prefix: "/fr", lang: "fr", label: "Francés", clicks: 0, sessions: 4 },
        { prefix: "/pt-br", lang: "pt", label: "Portugués", clicks: 3, sessions: 0 },
      ]);

      await addMarket(projectId, { lang: "en", prefix: "/en", isDefault: false }, db);
      expect((await getMarketSuggestions(projectId, db)).map((x) => x.prefix)).toEqual(["/es", "/fr", "/pt-br"]);
    });

    it("sin datos no sugiere nada", async () => {
      expect(await getMarketSuggestions(projectId, db)).toEqual([]);
    });
  });

  describe("datos por idioma", () => {
    beforeEach(async () => {
      // Sin idiomas declarados todo se ve junto. Aquí: español por defecto, inglés en /en y portugués en /pt.
      await addMarket(projectId, { lang: "es", prefix: "", isDefault: true }, db);
      await addMarket(projectId, { lang: "en", prefix: "/en", isDefault: false }, db);
      await addMarket(projectId, { lang: "pt", prefix: "/pt", isDefault: false }, db);

      await search(projectId, day(0), "/", 100);
      await search(projectId, day(0), "/contacto", 50);
      await search(projectId, day(0), "/english", 5); // empieza como /en pero no es /en
      await search(projectId, day(0), "/en", 30);
      await search(projectId, day(0), "/EN/Services", 20); // mayúsculas
      await search(projectId, day(0), "/pt/precos", 8);
      await search(projectId, day(-30), "/en/services", 12); // periodo anterior de 28 días
      await search(otherId, day(0), "/en/otro", 999); // otro proyecto

      await traffic(projectId, day(0), "/", 40);
      await traffic(projectId, day(0), "/en/services", 25);
      await traffic(projectId, day(0), "/pt/precos", 5);
      await ai(projectId, day(0), "/", 3);
      await ai(projectId, day(0), "/en/services", 6);
    });

    it("sin filtro suma todos los idiomas y reparte el total por idioma", async () => {
      const d = await getSeoDashboard(projectId, { days: 28 }, db);
      expect(d.lang).toBeNull();
      expect(d.markets.map((m) => m.lang)).toEqual(["es", "en", "pt"]);
      expect(d.search!.totals.clicks).toBe(100 + 50 + 5 + 30 + 20 + 8);
      expect(d.languages).toEqual([
        { lang: "es", label: "Español", isDefault: true, clicks: 155, impressions: 1550, sessions: 40 },
        { lang: "en", label: "Inglés", isDefault: false, clicks: 50, impressions: 500, sessions: 25 },
        { lang: "pt", label: "Portugués", isDefault: false, clicks: 8, impressions: 80, sessions: 5 },
      ]);
    });

    it("el filtro de un idioma con prefijo deja solo sus páginas en todo: indicadores, rankings, tráfico y visitas desde IA", async () => {
      const d = await getSeoDashboard(projectId, { days: 28, lang: "en" }, db);
      expect(d.lang).toBe("en");
      expect(d.search!.totals.clicks).toBe(30 + 20);
      expect(d.search!.topPages.map((p) => p.page).sort()).toEqual(["/EN/Services", "/en"]);
      expect(d.search!.previousTotals.clicks).toBe(12);
      expect(d.traffic!.totals.sessions).toBe(25);
      expect(d.ai!.totals.sessions).toBe(6);
      expect(d.search!.daily.reduce((a, p) => a + p.clicks, 0)).toBe(50);
    });

    it("el idioma por defecto es todo lo que no cuelga de otro prefijo, y /english no es inglés", async () => {
      const d = await getSeoDashboard(projectId, { days: 28, lang: "es" }, db);
      expect(d.search!.totals.clicks).toBe(100 + 50 + 5);
      expect(d.search!.topPages.map((p) => p.page).sort()).toEqual(["/", "/contacto", "/english"]);
      expect(d.traffic!.totals.sessions).toBe(40);
      expect(d.ai!.totals.sessions).toBe(3);
    });

    it("el desglose por idioma ignora el filtro: sigue mostrando todos para poder cambiar de uno a otro", async () => {
      const all = (await getSeoDashboard(projectId, { days: 28 }, db)).languages;
      const filtered = (await getSeoDashboard(projectId, { days: 28, lang: "pt" }, db)).languages;
      expect(filtered).toEqual(all);
    });

    it("un idioma que el proyecto no declaró se ignora, sin error", async () => {
      const d = await getSeoDashboard(projectId, { days: 28, lang: "fr" }, db);
      expect(d.lang).toBeNull();
      expect(d.search!.totals.clicks).toBe(213);
    });

    it("un idioma sin datos en el periodo deja las secciones vacías", async () => {
      await addMarket(projectId, { lang: "fr", prefix: "/fr", isDefault: false }, db);
      const d = await getSeoDashboard(projectId, { days: 28, lang: "fr" }, db);
      expect(d.search).toBeNull();
      expect(d.traffic).toBeNull();
      expect(d.languages?.find((l) => l.lang === "fr")).toMatchObject({ clicks: 0, sessions: 0 });
    });
  });

  describe("sin idioma por defecto", () => {
    beforeEach(async () => {
      await addMarket(projectId, { lang: "es", prefix: "/es", isDefault: false }, db);
      await addMarket(projectId, { lang: "en", prefix: "/en", isDefault: false }, db);
      await search(projectId, day(0), "/es/a", 10);
      await search(projectId, day(0), "/en/a", 20);
      await search(projectId, day(0), "/blog/x", 4);
      await traffic(projectId, day(0), "/", 9);
    });

    it("las páginas que no caen bajo ningún prefijo forman el grupo «Sin idioma», que se puede filtrar", async () => {
      const d = await getSeoDashboard(projectId, { days: 28 }, db);
      expect(d.languages!.find((l) => l.lang === "none")).toEqual({ lang: "none", label: "Sin idioma", isDefault: false, clicks: 4, impressions: 40, sessions: 9 });
      const f = await getSeoDashboard(projectId, { days: 28, lang: "none" }, db);
      expect(f.lang).toBe("none");
      expect(f.search!.totals.clicks).toBe(4);
      expect(f.traffic!.totals.sessions).toBe(9);
    });

    it("si todas las páginas encajan, no aparece «Sin idioma»", async () => {
      await db.delete(s.seoSearchDaily).where(eq(s.seoSearchDaily.page, "/blog/x"));
      await db.delete(s.seoTrafficDaily).where(eq(s.seoTrafficDaily.page, "/"));
      await traffic(projectId, day(0), "/es/a", 3);
      const d = await getSeoDashboard(projectId, { days: 28 }, db);
      expect(d.languages!.some((l) => l.lang === "none")).toBe(false);
    });
  });

  it("un proyecto sin idiomas declarados no tiene desglose ni filtro", async () => {
    await search(projectId, day(0), "/en/a", 5);
    const d = await getSeoDashboard(projectId, { days: 28, lang: "en" }, db);
    expect(d.markets).toEqual([]);
    expect(d.languages).toBeNull();
    expect(d.lang).toBeNull();
    expect(d.search!.totals.clicks).toBe(5);
  });
});
