import { describe, expect, it } from "vitest";
import {
  addDays,
  averagePosition,
  channelLabel,
  countryName,
  ctr,
  deviceLabel,
  eachDay,
  fillDays,
  latestDate,
  parseSeoPeriod,
  percentChange,
  periodRange,
  previousRange,
} from "@/server/domain/seo-data";

describe("periodos", () => {
  it("acepta 7, 28 y 90 (número o texto) y cae en 28 con cualquier otra cosa", () => {
    expect(parseSeoPeriod("7")).toBe(7);
    expect(parseSeoPeriod(28)).toBe(28);
    expect(parseSeoPeriod("90")).toBe(90);
    expect(parseSeoPeriod(["7", "90"])).toBe(7);
    for (const raw of [undefined, null, "", "30", "0", "-7", "7.5", "abc", "1e1", "365"]) expect(parseSeoPeriod(raw)).toBe(28);
  });
});

describe("fechas y rangos", () => {
  it("suma días cruzando meses, años y años bisiestos", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
  });
  it("rechaza fechas que no existen", () => {
    expect(() => addDays("2026-02-30", 1)).toThrow(/Fecha no válida/);
    expect(() => addDays("ayer", 1)).toThrow(/Fecha no válida/);
  });
  it("un periodo de N días termina en la fecha dada e incluye N días", () => {
    const r = periodRange("2026-11-08", 7);
    expect(r).toEqual({ from: "2026-11-02", to: "2026-11-08", days: 7 });
    expect(eachDay(r.from, r.to)).toHaveLength(7);
  });
  it("el periodo anterior tiene igual longitud y termina el día antes", () => {
    const r = periodRange("2026-11-08", 28);
    const p = previousRange(r);
    expect(p.days).toBe(28);
    expect(p.to).toBe(addDays(r.from, -1));
    expect(eachDay(p.from, p.to)).toHaveLength(28);
    expect(previousRange(periodRange("2026-01-10", 7))).toEqual({ from: "2025-12-28", to: "2026-01-03", days: 7 });
  });
  it("eachDay vacío si el inicio es posterior al final", () => {
    expect(eachDay("2026-01-02", "2026-01-01")).toEqual([]);
  });
  it("latestDate ignora vacíos", () => {
    expect(latestDate([null, "2026-01-03", undefined, "2026-02-01"])).toBe("2026-02-01");
    expect(latestDate([null, undefined])).toBeNull();
  });
  it("fillDays rellena con ceros los días sin datos y conserva los que hay", () => {
    const out = fillDays({ from: "2026-01-01", to: "2026-01-04" }, [{ date: "2026-01-02", n: 5 }], (date) => ({ date, n: 0 }));
    expect(out).toEqual([
      { date: "2026-01-01", n: 0 },
      { date: "2026-01-02", n: 5 },
      { date: "2026-01-03", n: 0 },
      { date: "2026-01-04", n: 0 },
    ]);
  });
});

describe("métricas", () => {
  it("variación porcentual: null si el anterior es 0", () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(50, 100)).toBe(-50);
    expect(percentChange(100, 100)).toBe(0);
    expect(percentChange(10, 0)).toBeNull();
    expect(percentChange(0, 0)).toBeNull();
    expect(percentChange(0, 20)).toBe(-100);
  });
  it("CTR como fracción y 0 sin impresiones", () => {
    expect(ctr(5, 100)).toBe(0.05);
    expect(ctr(0, 0)).toBe(0);
  });
  it("posición media ponderada por impresiones; null sin impresiones", () => {
    // 100 impresiones en posición 2 y 300 en posición 6 -> (200 + 1800) / 400 = 5
    expect(averagePosition(2 * 100 + 6 * 300, 400)).toBe(5);
    expect(averagePosition(0, 0)).toBeNull();
  });
});

describe("países y dispositivos", () => {
  it("nombres en español de los códigos de Search Console", () => {
    const esperados: Record<string, string> = { col: "Colombia", ven: "Venezuela", usa: "Estados Unidos", esp: "España", mex: "México", gbr: "Reino Unido", deu: "Alemania", dom: "República Dominicana", pri: "Puerto Rico" };
    for (const [code, name] of Object.entries(esperados)) expect(countryName(code)).toBe(name);
  });
  it("conoce al menos los 60 más comunes que pide el módulo", () => {
    const comunes = "col ven usa esp mex arg chl per ecu aus bra prt gbr can deu fra ita pan cri dom ury pry bol gtm hnd slv nic cub pri nld bel che aut irl swe nor dnk fin pol rou grc tur rus ukr chn jpn kor ind idn phl isr sau are mar egy zaf nga nzl hkg sgp".split(" ");
    expect(comunes.length).toBeGreaterThanOrEqual(60);
    for (const code of comunes) expect(countryName(code), code).not.toBe(code.toUpperCase());
  });
  it("ignora mayúsculas y espacios; un código desconocido vuelve en mayúsculas", () => {
    expect(countryName(" COL ")).toBe("Colombia");
    expect(countryName("xyz")).toBe("XYZ");
  });
  it("grupos de canal de GA4 en español; los desconocidos quedan igual", () => {
    expect(channelLabel("Organic Search")).toBe("Búsqueda orgánica");
    expect(channelLabel("Direct")).toBe("Directo");
    expect(channelLabel("Canal Raro")).toBe("Canal Raro");
  });
  it("etiquetas de dispositivo", () => {
    expect(deviceLabel("MOBILE")).toBe("Móvil");
    expect(deviceLabel("DESKTOP")).toBe("Escritorio");
    expect(deviceLabel("TABLET")).toBe("Tableta");
    expect(deviceLabel("TV")).toBe("TV");
  });
});
