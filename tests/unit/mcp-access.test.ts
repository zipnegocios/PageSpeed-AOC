import { describe, expect, it } from "vitest";
import { ACCESS_ALL, accessFromRow, accessSummary, canAccessProject } from "@/server/domain/mcp-access";

const p = (id: string, clientId: string) => ({ id, clientId });

describe("alcance de una clave", () => {
  it("acceso total llega a cualquier proyecto", () => {
    expect(canAccessProject(ACCESS_ALL, p("p1", "c1"))).toBe(true);
  });

  it("por cliente: todos sus proyectos; por proyecto: solo ese", () => {
    const byClient = { all: false as const, clientIds: ["c1"], projectIds: [] };
    expect(canAccessProject(byClient, p("p1", "c1"))).toBe(true);
    expect(canAccessProject(byClient, p("p2", "c1"))).toBe(true);
    expect(canAccessProject(byClient, p("p3", "c2"))).toBe(false);
    const byProject = { all: false as const, clientIds: [], projectIds: ["p3"] };
    expect(canAccessProject(byProject, p("p3", "c2"))).toBe(true);
    expect(canAccessProject(byProject, p("p4", "c2"))).toBe(false);
  });

  it("una lista vacía no da acceso a nada", () => {
    expect(canAccessProject({ all: false, clientIds: [], projectIds: [] }, p("p1", "c1"))).toBe(false);
  });

  it("se arma desde la fila y se resume en una línea", () => {
    expect(accessFromRow({ allAccess: true, clientIds: ["x"], projectIds: [] })).toEqual({ all: true });
    expect(accessFromRow({ allAccess: false, clientIds: ["a"], projectIds: ["b"] })).toEqual({ all: false, clientIds: ["a"], projectIds: ["b"] });
    expect(accessSummary(ACCESS_ALL)).toBe("Acceso total");
    expect(accessSummary({ all: false, clientIds: ["a", "b"], projectIds: ["c"] })).toBe("2 clientes · 1 proyecto");
    expect(accessSummary({ all: false, clientIds: ["a"], projectIds: [] })).toBe("1 cliente");
    expect(accessSummary({ all: false, clientIds: [], projectIds: [] })).toBe("Sin acceso");
  });
});
