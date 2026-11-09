import { describe, expect, it } from "vitest";
import { aggregateAi, aggregateSearch, aggregateTraffic, CHUNK_DAYS, ga4Date, INITIAL_DAYS, LAG_DAYS, MAX_BACKFILL_DAYS, planSyncWindows } from "@/server/domain/seo-sync";

const NOW = new Date("2026-11-10T15:30:00Z");

describe("ventanas de descarga", () => {
  it("la primera vez pide 90 días en tres ventanas de 30, hasta el último día que Google ya cerró", () => {
    const w = planSyncWindows(null, "gsc", NOW);
    expect(w).toEqual([
      { from: "2026-08-10", to: "2026-09-08" },
      { from: "2026-09-09", to: "2026-10-08" },
      { from: "2026-10-09", to: "2026-11-07" },
    ]);
    expect(INITIAL_DAYS).toBe(90);
    expect(CHUNK_DAYS).toBe(30);
  });

  it("GA4 cierra antes que Search Console: menos días de retraso", () => {
    expect(LAG_DAYS).toEqual({ gsc: 3, ga4: 1 });
    const w = planSyncWindows(null, "ga4", NOW);
    expect(w.at(-1)?.to).toBe("2026-11-09");
    expect(w[0]?.from).toBe("2026-08-12");
  });

  it("después repasa desde una semana antes del último día guardado", () => {
    expect(planSyncWindows("2026-11-07", "gsc", NOW)).toEqual([{ from: "2026-11-01", to: "2026-11-07" }]);
    // Un día más tarde, avanza el final.
    expect(planSyncWindows("2026-11-07", "gsc", new Date("2026-11-11T09:00:00Z"))).toEqual([{ from: "2026-11-01", to: "2026-11-08" }]);
  });

  it("si lo guardado va por delante del último día cerrado, repasa solo ese día", () => {
    expect(planSyncWindows("2026-11-20", "gsc", NOW)).toEqual([{ from: "2026-11-07", to: "2026-11-07" }]);
  });

  it("tras una pausa larga recupera lo que falta por ventanas, sin pasar de lo que Search Console conserva", () => {
    const w = planSyncWindows("2026-09-01", "gsc", NOW);
    expect(w[0]?.from).toBe("2026-08-26");
    expect(w.at(-1)?.to).toBe("2026-11-07");
    for (const win of w) expect((Date.parse(win.to) - Date.parse(win.from)) / 86_400_000).toBeLessThanOrEqual(CHUNK_DAYS - 1);

    const viejo = planSyncWindows("2020-01-01", "gsc", NOW);
    const dias = (Date.parse(viejo.at(-1)!.to) - Date.parse(viejo[0]!.from)) / 86_400_000 + 1;
    expect(dias).toBe(MAX_BACKFILL_DAYS);
  });

  it("las ventanas no se solapan ni dejan huecos", () => {
    const w = planSyncWindows(null, "gsc", NOW);
    for (let i = 1; i < w.length; i++) {
      expect(Date.parse(w[i]!.from) - Date.parse(w[i - 1]!.to)).toBe(86_400_000);
    }
  });
});

describe("agregación de Search Console", () => {
  const rec = (page: string, clicks: number, impressions: number, position: number, extra: Record<string, string> = {}) => ({
    keys: { date: "2026-11-01", page, country: "COL", device: "mobile", ...extra },
    clicks,
    impressions,
    position,
  });

  it("suma las URL que son la misma página y pondera la posición por impresiones", () => {
    const rows = aggregateSearch([rec("https://acme.test/es/precios", 10, 100, 4), rec("https://acme.test/es/precios/?utm=1", 5, 50, 7), rec("https://www.acme.test/es/precios#a", 1, 50, 10)]);
    expect(rows).toEqual([{ date: "2026-11-01", page: "/es/precios", country: "col", device: "MOBILE", clicks: 16, impressions: 200, positionSum: 4 * 100 + 7 * 50 + 10 * 50 }]);
    expect(rows[0]!.positionSum / rows[0]!.impressions).toBeCloseTo(6.25);
  });

  it("separa por día, país y dispositivo", () => {
    const rows = aggregateSearch([rec("https://a.test/", 1, 10, 3), rec("https://a.test/", 1, 10, 3, { country: "usa" }), rec("https://a.test/", 1, 10, 3, { device: "DESKTOP" }), rec("https://a.test/", 1, 10, 3, { date: "2026-11-02" })]);
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.page))).toEqual(new Set(["/"]));
  });
});

describe("agregación de GA4", () => {
  it("convierte la fecha de GA4", () => {
    expect(ga4Date("20261101")).toBe("2026-11-01");
    expect(ga4Date("2026-11-01")).toBe("2026-11-01");
  });

  it("suma sesiones y usuarios por página normalizada, país y canal", () => {
    const row = (pagePath: string, sessions: number, extra: Record<string, string> = {}) => ({
      dims: { date: "20261101", pagePath, country: "Colombia", sessionDefaultChannelGroup: "Organic Search", ...extra },
      metrics: { sessions, totalUsers: sessions - 1 },
    });
    const rows = aggregateTraffic([row("/es/precios/", 5), row("/es/precios", 3), row("/", 2, { sessionDefaultChannelGroup: "Direct" }), row("/", 1, { country: "" })]);
    expect(rows).toContainEqual({ date: "2026-11-01", page: "/es/precios", country: "Colombia", channel: "Organic Search", sessions: 8, users: 6 });
    expect(rows).toContainEqual({ date: "2026-11-01", page: "/", country: "Colombia", channel: "Direct", sessions: 2, users: 1 });
    expect(rows.find((r) => r.country === "(not set)")?.sessions).toBe(1);
    expect(rows).toHaveLength(3);
  });

  it("agrupa las visitas desde IA por fuente en minúsculas", () => {
    const row = (sessionSource: string, sessions: number) => ({ dims: { date: "20261101", sessionSource, pagePath: "/es/" }, metrics: { sessions, totalUsers: sessions } });
    expect(aggregateAi([row("ChatGPT.com", 2), row("chatgpt.com", 1), row("perplexity.ai", 4)])).toEqual([
      { date: "2026-11-01", source: "chatgpt.com", page: "/es", sessions: 3, users: 3 },
      { date: "2026-11-01", source: "perplexity.ai", page: "/es", sessions: 4, users: 4 },
    ]);
  });
});
