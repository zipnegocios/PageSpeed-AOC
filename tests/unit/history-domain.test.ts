import { describe, expect, it } from "vitest";
import {
  average, computeChange, formatMetric, metricValue, parseMetric, parsePeriod, periodStart,
} from "@/server/domain/history";
import { layoutChart } from "@/lib/chart-layout";

describe("parseMetric / parsePeriod", () => {
  it("aceptan solo valores conocidos y usan un valor por defecto", () => {
    expect(parseMetric("seo")).toBe("seo");
    expect(parseMetric("lcp")).toBe("lcp");
    expect(parseMetric("nope")).toBe("performance");
    expect(parseMetric(undefined)).toBe("performance");
    expect(parsePeriod("7")).toBe(7);
    expect(parsePeriod("365")).toBe(365);
    expect(parsePeriod("12")).toBe(30);
    expect(parsePeriod(null)).toBe(30);
  });
  it("el inicio del periodo resta días", () => {
    expect(periodStart(new Date("2026-03-31T00:00:00Z"), 30).toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });
});

describe("metricValue / formatMetric", () => {
  const row = { scorePerformance: 80, scoreSeo: 90, scoreAccessibility: null, scoreBestPractices: 100, lcpMs: 2500, tbtMs: 120, cls: "0.0500" };
  it("lee cada métrica, incluido el CLS que llega como texto", () => {
    expect(metricValue(row, "performance")).toBe(80);
    expect(metricValue(row, "accessibility")).toBeNull();
    expect(metricValue(row, "lcp")).toBe(2500);
    expect(metricValue(row, "cls")).toBe(0.05);
    expect(metricValue({ ...row, cls: null }, "cls")).toBeNull();
    expect(metricValue({ ...row, cls: "x" }, "cls")).toBeNull();
  });
  it("da formato según la unidad", () => {
    expect(formatMetric("seo", 89.6)).toBe("90");
    expect(formatMetric("lcp", 2540)).toBe("2.5 s");
    expect(formatMetric("tbt", 120.4)).toBe("120 ms");
    expect(formatMetric("cls", 0.05)).toBe("0.050");
    expect(formatMetric("seo", null)).toBe("—");
  });
});

describe("computeChange", () => {
  it.each([
    ["performance", 72, 61, "up", "better", "11 puntos"],
    ["performance", 61, 72, "down", "worse", "11 puntos"],
    ["seo", 91, 90, "up", "better", "1 punto"],
    ["seo", 90, 90, "same", "same", "sin cambio"],
    ["lcp", 3200, 2500, "up", "worse", "0.7 s"],
    ["lcp", 2000, 2500, "down", "better", "0.5 s"],
    ["tbt", 300, 200, "up", "worse", "100 ms"],
    ["cls", 0.2, 0.05, "up", "worse", "0.150"],
  ] as const)("%s %s vs %s", (metric, cur, prev, direction, verdict, text) => {
    expect(computeChange(metric, cur, prev)).toMatchObject({ direction, verdict, text });
  });
  it("sin dato en alguno de los dos no hay variación", () => {
    expect(computeChange("seo", null, 80)).toBeNull();
    expect(computeChange("seo", 80, null)).toBeNull();
  });
  it("un cambio menor a lo que se muestra cuenta como sin cambio", () => {
    expect(computeChange("lcp", 2510, 2500)?.verdict).toBe("same");
  });
});

describe("average", () => {
  it("promedia lo presente e ignora los vacíos", () => {
    expect(average([80, 90, null])).toBe(85);
    expect(average([null])).toBeNull();
    expect(average([])).toBeNull();
  });
});

describe("layoutChart", () => {
  const from = new Date("2026-03-01T00:00:00Z");
  const to = new Date("2026-03-31T00:00:00Z");
  const at = (d: string) => new Date(`2026-03-${d}T00:00:00Z`);

  it("las puntuaciones usan siempre 0-100 y colocan los puntos por fecha y valor", () => {
    const l = layoutChart({ points: [{ at: at("01"), value: 0 }, { at: at("16"), value: 50 }, { at: at("31"), value: 100 }], metric: "seo", from, to });
    expect(l.max).toBe(100);
    expect(l.points.map((p) => [Math.round(p.x), p.y])).toEqual([[0, 0], [50, 50], [100, 100]]);
    expect(l.yTicks.map((t) => t.label)).toEqual(["0", "25", "50", "75", "100"]);
    expect(l.xTicks).toHaveLength(4);
    expect(l.xTicks[0]).toMatchObject({ x: 0 });
  });

  it("la meta aparece como línea; sin meta, no", () => {
    const base = { points: [{ at: at("10"), value: 70 }], metric: "performance" as const, from, to };
    expect(layoutChart({ ...base, threshold: 90 }).threshold).toBe(90);
    expect(layoutChart({ ...base, threshold: null }).threshold).toBeNull();
    expect(layoutChart(base).threshold).toBeNull();
  });

  it("los tiempos parten de cero y la escala cubre el mayor valor", () => {
    const l = layoutChart({ points: [{ at: at("05"), value: 2400 }, { at: at("20"), value: 4100 }], metric: "lcp", from, to });
    expect(l.max).toBeGreaterThanOrEqual(4100);
    expect(l.yTicks[0]).toMatchObject({ y: 0, label: "0.0 s" });
    expect(l.points.every((p) => p.y >= 0 && p.y <= 100)).toBe(true);
    const peak = l.points.find((p) => p.value === 4100)!;
    expect(peak.y).toBeGreaterThan(60);
  });

  it("el CLS usa una escala pequeña y legible", () => {
    const l = layoutChart({ points: [{ at: at("05"), value: 0.12 }], metric: "cls", from, to });
    expect(l.max).toBeLessThanOrEqual(0.2);
    expect(l.max).toBeGreaterThanOrEqual(0.12);
  });

  it("sin puntos no falla y los puntos fuera del periodo se acotan", () => {
    expect(layoutChart({ points: [], metric: "lcp", from, to }).points).toEqual([]);
    const l = layoutChart({ points: [{ at: new Date("2026-02-01T00:00:00Z"), value: 50 }], metric: "seo", from, to });
    expect(l.points[0]!.x).toBe(0);
  });
});
