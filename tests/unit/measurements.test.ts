import { describe, expect, it } from "vitest";
import { MEASUREMENTS, MEASUREMENT_BY_ID, measurementStates } from "@/server/domain/measurements";

describe("lista única de mediciones", () => {
  it("cada medición tiene id único, título, fuente y pregunta", () => {
    expect(new Set(MEASUREMENTS.map((m) => m.id)).size).toBe(MEASUREMENTS.length);
    for (const m of MEASUREMENTS) {
      expect(m.title.length).toBeGreaterThan(3);
      expect(m.source.length).toBeGreaterThan(3);
      expect(m.question).toContain("?");
      expect(MEASUREMENT_BY_ID[m.id]).toBe(m);
    }
  });

  it("lo que depende del acceso a tráfico y búsqueda queda «no activado» sin él; lo demás sigue incluido", () => {
    const st = measurementStates({ seoAccess: false, has: { speed: true, improvements: true } });
    for (const m of MEASUREMENTS) expect(st[m.id]).toBe(m.needsSeoAccess ? "off" : "included");
  });

  it("con acceso, lo que no tiene datos todavía figura «aún sin datos» y lo demás, incluido", () => {
    const st = measurementStates({ seoAccess: true, has: { search: false, traffic: true } });
    expect(st.search).toBe("pending");
    expect(st.traffic).toBe("included");
    expect(st.sources).toBe("included");
  });
});
