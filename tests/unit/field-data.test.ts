import { describe, expect, it } from "vitest";
import { assess, formatField, parseRecord, rate, type FieldMetrics } from "@/server/domain/field-data";
import { CruxError, fetchFieldData, type FetchLike } from "@/server/services/crux";

const hist = (a: number, b: number, c: number, ends: [unknown, unknown] = [2500, 4000]) => [
  { start: 0, end: ends[0], density: a },
  { start: ends[0], end: ends[1], density: b },
  { start: ends[1], density: c },
];

/** Respuesta con la forma real de la API de CrUX (CLS como texto, rangos y densidades). */
const body = (over: Record<string, unknown> = {}) => ({
  record: {
    key: { formFactor: "PHONE", origin: "https://acme.test" },
    metrics: {
      largest_contentful_paint: { histogram: hist(0.7, 0.2, 0.1), percentiles: { p75: 2900 } },
      interaction_to_next_paint: { histogram: hist(0.8, 0.15, 0.05, [200, 500]), percentiles: { p75: 180 } },
      cumulative_layout_shift: { histogram: [{ start: "0.00", end: "0.10", density: 0.9 }, { start: "0.10", end: "0.25", density: 0.07 }, { start: "0.25", density: 0.03 }], percentiles: { p75: "0.05" } },
      first_contentful_paint: { histogram: hist(0.6, 0.3, 0.1, [1800, 3000]), percentiles: { p75: 2100 } },
      experimental_time_to_first_byte: { histogram: hist(0.5, 0.4, 0.1, [800, 1800]), percentiles: { p75: 950 } },
      ...over,
    },
    collectionPeriod: { firstDate: { year: 2026, month: 10, day: 5 }, lastDate: { year: 2026, month: 11, day: 1 } },
  },
});

describe("interpretación de la respuesta", () => {
  it("lee percentil 75, reparto y periodo, con el CLS que llega como texto", () => {
    const r = parseRecord(body())!;
    expect(r.first).toBe("2026-10-05");
    expect(r.last).toBe("2026-11-01");
    expect(r.metrics.lcp).toEqual({ p75: 2900, good: 70, needsImprovement: 20, poor: 10 });
    expect(r.metrics.cls).toEqual({ p75: 0.05, good: 90, needsImprovement: 7, poor: 3 });
    expect(r.metrics.inp?.p75).toBe(180);
    expect(r.metrics.ttfb?.p75).toBe(950);
  });
  it("ignora métricas ausentes o mal formadas y devuelve null sin ninguna", () => {
    const r = parseRecord(body({ interaction_to_next_paint: undefined, first_contentful_paint: { histogram: [] } }))!;
    expect(r.metrics.inp).toBeUndefined();
    expect(r.metrics.fcp).toBeUndefined();
    expect(r.metrics.lcp).toBeDefined();
    for (const bad of [null, undefined, {}, { record: {} }, { record: { metrics: {} } }, "x"]) expect(parseRecord(bad)).toBeNull();
  });
  it("densidades fuera de rango se acotan y un percentil ausente queda en null", () => {
    const r = parseRecord(body({ largest_contentful_paint: { histogram: hist(1.4, -0.2, 0), percentiles: {} } }))!;
    expect(r.metrics.lcp).toEqual({ p75: null, good: 100, needsImprovement: 0, poor: 0 });
  });
});

describe("valoración con los umbrales de Core Web Vitals", () => {
  it.each([
    ["lcp", 2500, "good"], ["lcp", 2501, "needs-improvement"], ["lcp", 4000, "needs-improvement"], ["lcp", 4001, "poor"],
    ["inp", 200, "good"], ["inp", 201, "needs-improvement"], ["inp", 500, "needs-improvement"], ["inp", 501, "poor"],
    ["cls", 0.1, "good"], ["cls", 0.11, "needs-improvement"], ["cls", 0.25, "needs-improvement"], ["cls", 0.26, "poor"],
    ["fcp", 1800, "good"], ["fcp", 3001, "poor"], ["ttfb", 800, "good"], ["ttfb", 1801, "poor"],
  ] as const)("%s %s → %s", (metric, value, expected) => {
    expect(rate(metric, value)).toBe(expected);
  });
  it("sin percentil no hay valoración", () => {
    expect(rate("lcp", null)).toBeNull();
  });
  const m = (lcp: number | null, inp: number | null, cls: number | null): FieldMetrics => ({
    ...(lcp !== null ? { lcp: { p75: lcp, good: 0, needsImprovement: 0, poor: 0 } } : {}),
    ...(inp !== null ? { inp: { p75: inp, good: 0, needsImprovement: 0, poor: 0 } } : {}),
    ...(cls !== null ? { cls: { p75: cls, good: 0, needsImprovement: 0, poor: 0 } } : {}),
  });
  it("aprueba solo con las tres en bueno; suspende si una falla aunque falten otras; sin datos si no se puede afirmar", () => {
    expect(assess(m(2000, 150, 0.05))).toBe("passed");
    expect(assess(m(3000, 150, 0.05))).toBe("failed");
    expect(assess(m(2000, 600, null))).toBe("failed");
    expect(assess(m(2000, null, 0.05))).toBe("no-data"); // sin INP no se puede aprobar
    expect(assess({})).toBe("no-data");
    expect(assess(null)).toBe("no-data");
  });
  it("da formato a cada unidad", () => {
    expect(formatField("lcp", 2900)).toBe("2.9 s");
    expect(formatField("fcp", 1800)).toBe("1.8 s");
    expect(formatField("inp", 180.4)).toBe("180 ms");
    expect(formatField("ttfb", 950)).toBe("950 ms");
    expect(formatField("cls", 0.05)).toBe("0.050");
    expect(formatField("lcp", null)).toBe("—");
  });
});

describe("consulta a la API", () => {
  const res = (status: number, json: unknown = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => json });
  const query = { apiKey: "CLAVE-SECRETA", target: { origin: "https://acme.test" }, formFactor: "mobile" as const };

  it("manda la clave en una cabecera, nunca en la dirección, y pide las cinco métricas del dispositivo", async () => {
    let seen: { url: string; headers: Record<string, string>; body: Record<string, unknown> } | undefined;
    const f: FetchLike = async (url, init) => ((seen = { url, headers: init.headers, body: JSON.parse(init.body) }), res(200, body()));
    const out = await fetchFieldData(query, f);
    expect(out.status).toBe("ok");
    expect(seen!.url).toBe("https://chromeuxreport.googleapis.com/v1/records:queryRecord");
    expect(seen!.url).not.toContain("CLAVE");
    expect(seen!.headers["X-Goog-Api-Key"]).toBe("CLAVE-SECRETA");
    expect(seen!.body).toMatchObject({ origin: "https://acme.test", formFactor: "PHONE" });
    expect(seen!.body.metrics).toEqual(expect.arrayContaining(["largest_contentful_paint", "interaction_to_next_paint", "cumulative_layout_shift"]));
    await fetchFieldData({ ...query, target: { url: "https://acme.test/x" }, formFactor: "desktop" }, async (_u, init) => ((seen = { url: "", headers: {}, body: JSON.parse(init.body) }), res(200, body())));
    expect(seen!.body).toMatchObject({ url: "https://acme.test/x", formFactor: "DESKTOP" });
  });
  it("404 es 'sin datos' (poco tráfico), no un fallo; una respuesta vacía también", async () => {
    expect(await fetchFieldData(query, async () => res(404))).toEqual({ status: "no_data" });
    expect(await fetchFieldData(query, async () => res(200, { record: { metrics: {} } }))).toEqual({ status: "no_data" });
    expect(await fetchFieldData(query, async () => ({ status: 200, ok: true, json: async () => { throw new Error("json"); } }))).toEqual({ status: "no_data" });
  });
  it.each([[403, "BAD_KEY"], [401, "BAD_KEY"], [429, "QUOTA"], [400, "INVALID"], [500, "UNAVAILABLE"], [503, "UNAVAILABLE"]] as const)("HTTP %s → %s", async (status, code) => {
    const err = await fetchFieldData(query, async () => res(status)).catch((e) => e);
    expect(err).toBeInstanceOf(CruxError);
    expect(err.code).toBe(code);
    expect(err.message).not.toContain("CLAVE-SECRETA");
  });
  it("un fallo de red es UNAVAILABLE y no filtra la clave", async () => {
    const err = await fetchFieldData(query, async () => { throw new Error("connect ECONNREFUSED CLAVE-SECRETA"); }).catch((e) => e);
    expect(err.code).toBe("UNAVAILABLE");
    expect(err.message).not.toContain("CLAVE-SECRETA");
  });
});
