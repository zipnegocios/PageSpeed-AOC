import { describe, expect, it } from "vitest";
import { METRIC_HINTS, readHint, type HintKey } from "@/server/domain/metric-hints";

describe("pistas de las siglas de Rutas", () => {
  const keys = Object.keys(METRIC_HINTS) as HintKey[];

  it("cada sigla trae nombre, una explicación llana y, si tiene bandas, sus tres rangos", () => {
    expect(keys.sort()).toEqual(["A", "AG", "B", "CLS", "IA", "LCP", "R", "S", "TBT"]);
    for (const k of keys) {
      const h = METRIC_HINTS[k];
      expect(h.name.length).toBeGreaterThan(2);
      expect(h.text.length).toBeGreaterThan(30);
      expect(h.text.endsWith(".")).toBe(true);
      expect(h.ranges === null || h.ranges.length === 3).toBe(true);
    }
  });

  it("la explicación no usa jerga: ninguna palabra técnica sin explicar", () => {
    for (const k of keys) expect(METRIC_HINTS[k].text).not.toMatch(/Lighthouse|DOM|render|JavaScript|bundle|CDN|TTFB/i);
  });

  it("las notas se leen con la misma regla de bandas del resto del portal", () => {
    expect(readHint("R", 95)).toEqual({ tone: "ok", word: "bueno", valueText: "95" });
    expect(readHint("S", 72)).toEqual({ tone: "warning", word: "mejorable", valueText: "72" });
    expect(readHint("A", 30)).toEqual({ tone: "danger", word: "deficiente", valueText: "30" });
    expect(readHint("B", 90)?.tone).toBe("ok");
    expect(readHint("B", 89)?.tone).toBe("warning");
    expect(readHint("B", 49)?.tone).toBe("danger");
  });

  it("las métricas se leen con los umbrales de Google y se formatean en español", () => {
    expect(readHint("LCP", 2400)).toEqual({ tone: "ok", word: "bueno", valueText: "2,4 s" });
    expect(readHint("LCP", 3000)).toMatchObject({ tone: "warning", valueText: "3 s" });
    expect(readHint("LCP", 4100)?.tone).toBe("danger");
    expect(readHint("CLS", 0.05)).toMatchObject({ tone: "ok", valueText: "0,05" });
    expect(readHint("CLS", 0.3)?.tone).toBe("danger");
    expect(readHint("TBT", 150)).toEqual({ tone: "ok", word: "bueno", valueText: "150 ms" });
    expect(readHint("TBT", 700)?.tone).toBe("danger");
  });

  it("la navegación agéntica no tiene meta ni color; sin dato no hay lectura", () => {
    expect(readHint("IA", "12/20")).toEqual({ tone: "none", word: "sin meta", valueText: "12/20" });
    expect(readHint("AG", "14/20")?.tone).toBe("none");
    for (const k of keys) expect(readHint(k, null)).toBeNull();
    expect(readHint("R", "abc")).toBeNull();
  });
});
