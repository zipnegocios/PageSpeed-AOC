import { describe, expect, it } from "vitest";
import { projectCron, projectIdFromScheduler, schedulerId } from "@/server/domain/schedule";

const ids = Array.from({ length: 400 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);

describe("projectCron", () => {
  it("es determinista: el mismo proyecto cae siempre en el mismo momento", () => {
    expect(projectCron(ids[0]!, "weekly")).toBe(projectCron(ids[0]!, "weekly"));
    expect(projectCron(ids[0]!, "daily")).toBe(projectCron(ids[0]!, "daily"));
  });

  it("semanal y diaria comparten minuto y hora; solo la semanal fija un día", () => {
    for (const id of ids.slice(0, 50)) {
      const [m1, h1, , , dow] = projectCron(id, "weekly").split(" ");
      const [m2, h2, d2, mo2, dow2] = projectCron(id, "daily").split(" ");
      expect([m1, h1]).toEqual([m2, h2]);
      expect(dow).toMatch(/^[0-6]$/);
      expect([d2, mo2, dow2]).toEqual(["*", "*", "*"]);
    }
  });

  it("genera siempre valores de cron válidos (minuto 0-59, hora 0-23, día 0-6)", () => {
    for (const id of ids) {
      const [m, h, dom, month, dow] = projectCron(id, "weekly").split(" ").map((x) => (x === "*" ? x : Number(x)));
      expect(m).toBeGreaterThanOrEqual(0); expect(m).toBeLessThanOrEqual(59);
      expect(h).toBeGreaterThanOrEqual(0); expect(h).toBeLessThanOrEqual(23);
      expect([dom, month]).toEqual(["*", "*"]);
      expect(dow).toBeGreaterThanOrEqual(0); expect(dow).toBeLessThanOrEqual(6);
    }
  });

  it("reparte los proyectos: no se amontonan en una sola hora ni en un solo día", () => {
    const hours = new Set(ids.map((id) => projectCron(id, "daily").split(" ")[1]));
    const days = new Set(ids.map((id) => projectCron(id, "weekly").split(" ")[4]));
    expect(hours.size).toBeGreaterThanOrEqual(20);
    expect(days.size).toBe(7);
  });
});

describe("identificadores del agendador", () => {
  it("van y vuelven con el prefijo project:", () => {
    expect(schedulerId("abc")).toBe("project:abc");
    expect(projectIdFromScheduler("project:abc")).toBe("abc");
    expect(projectIdFromScheduler("reconcile")).toBeNull();
    expect(projectIdFromScheduler(null)).toBeNull();
    expect(projectIdFromScheduler(undefined)).toBeNull();
  });
});
