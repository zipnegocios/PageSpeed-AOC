import { describe, expect, it } from "vitest";
import { formatAgo } from "@/lib/audit-format";
import { groupAuditsByPage, type RecentAudit } from "@/server/services/dashboard";
import { filterProjectItems, normalize, type SwitcherItem } from "@/lib/project-search";
import { RING_ARC, ringDashes } from "@/lib/ring";
import { sparklineLayout } from "@/lib/sparkline";

describe("sparklineLayout", () => {
  it("con menos de 2 valores no hay línea", () => {
    expect(sparklineLayout([], 100, 30)).toBeNull();
    expect(sparklineLayout([80], 100, 30)).toBeNull();
  });
  it("reparte los puntos a lo ancho y una subida va hacia arriba (y menor)", () => {
    const l = sparklineLayout([50, 60, 70, 80], 100, 30, 5)!;
    expect(l.points).toHaveLength(4);
    expect(l.points[0]!.x).toBe(5);
    expect(l.last.x).toBe(95);
    expect(l.points[0]!.y).toBeGreaterThan(l.last.y);
    expect(l.line.startsWith("M5 ")).toBe(true);
    expect(l.area.endsWith("Z")).toBe(true);
  });
  it("una serie plana queda en el centro y una variación mínima no se exagera", () => {
    const flat = sparklineLayout([90, 90, 90], 100, 30, 5)!;
    expect(new Set(flat.points.map((p) => p.y)).size).toBe(1);
    const tiny = sparklineLayout([90, 91], 100, 30, 5)!;
    expect(tiny.points[0]!.y - tiny.points[1]!.y).toBeLessThan(5); // rango visible de 10 puntos, no de 1
  });
  it("los valores siempre quedan dentro del rectángulo", () => {
    const l = sparklineLayout([0, 100, 0, 100], 100, 30, 5)!;
    for (const p of l.points) {
      expect(p.y).toBeGreaterThanOrEqual(5);
      expect(p.y).toBeLessThanOrEqual(25);
    }
  });
});

describe("ringDashes", () => {
  it("0 no dibuja arco, 100 lo completa y 50 es la mitad", () => {
    const arcLen = (v: number) => Number(ringDashes(v).arc.split(" ")[0]);
    expect(arcLen(0)).toBe(0);
    expect(arcLen(100)).toBeCloseTo(RING_ARC, 1);
    expect(arcLen(50)).toBeCloseTo(RING_ARC / 2, 1);
  });
  it("recorta lo que se sale de 0-100", () => {
    expect(ringDashes(150).arc).toBe(ringDashes(100).arc);
    expect(ringDashes(-5).arc).toBe(ringDashes(0).arc);
  });
});

describe("búsqueda de proyectos", () => {
  const items: SwitcherItem[] = [
    { id: "1", name: "Tienda Web", clientName: "Acme S.A.", href: "/a", phase: "production" },
    { id: "2", name: "Blog", clientName: "Café Ñandú", href: "/b", phase: "development" },
    { id: "3", name: "Café Online", clientName: "Beta", href: "/c", phase: "production" },
  ];
  it("sin acentos ni mayúsculas, por proyecto o por cliente", () => {
    expect(normalize(" Café Ñandú ")).toBe("cafe nandu");
    expect(filterProjectItems(items, "cafe").map((i) => i.id)).toEqual(["3", "2"]); // empieza por 'cafe' primero
    expect(filterProjectItems(items, "ACME").map((i) => i.id)).toEqual(["1"]);
  });
  it("todas las palabras deben aparecer y sin búsqueda devuelve todo en orden", () => {
    expect(filterProjectItems(items, "blog nandu").map((i) => i.id)).toEqual(["2"]);
    expect(filterProjectItems(items, "blog acme")).toEqual([]);
    expect(filterProjectItems(items, "  ").map((i) => i.id)).toEqual(["1", "2", "3"]);
  });
});

describe("formatAgo", () => {
  const now = new Date("2026-11-06T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);
  it("minutos, horas y días", () => {
    expect(formatAgo(ago(20_000), now)).toBe("ahora");
    expect(formatAgo(ago(5 * 60_000), now)).toBe("hace 5 min");
    expect(formatAgo(ago(3 * 3_600_000), now)).toBe("hace 3 h");
    expect(formatAgo(ago(2 * 86_400_000), now)).toBe("hace 2 d");
    expect(formatAgo(null, now)).toBe("—");
  });
});

describe("groupAuditsByPage", () => {
  const row = (over: Partial<RecentAudit>): RecentAudit => ({
    id: "a", status: "succeeded", profile: "mobile", routePath: "/", errorCode: null, scorePerformance: 90, scoreSeo: 90, scoreAccessibility: 90, scoreBestPractices: 90,
    queuedAt: new Date("2026-11-06T10:00:00Z"), finishedAt: null, projectId: "p1", projectName: "Uno", projectSlug: "uno", clientName: "Acme", clientSlug: "acme", ...over,
  });
  it("junta móvil y escritorio de la misma página y conserva la más reciente de cada uno", () => {
    const g = groupAuditsByPage([
      row({ id: "m-nueva", profile: "mobile" }),
      row({ id: "d-nueva", profile: "desktop" }),
      row({ id: "m-vieja", profile: "mobile" }),
      row({ id: "d-vieja", profile: "desktop" }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]!.mobile!.id).toBe("m-nueva");
    expect(g[0]!.desktop!.id).toBe("d-nueva");
  });
  it("separa páginas y proyectos distintos y respeta el orden de aparición", () => {
    const g = groupAuditsByPage([
      row({ id: "1", projectId: "p2", projectName: "Dos" }),
      row({ id: "2", routePath: "/contacto" }),
      row({ id: "3", profile: "desktop", projectId: "p2", projectName: "Dos" }),
      row({ id: "4" }),
    ]);
    expect(g.map((e) => `${e.projectName}${e.routePath}`)).toEqual(["Dos/", "Uno/contacto", "Uno/"]);
    expect(g[0]!.desktop!.id).toBe("3");
    expect(g[2]!.desktop).toBeNull();
  });
  it("sin filas no hay entradas", () => {
    expect(groupAuditsByPage([])).toEqual([]);
  });
});
