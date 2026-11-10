import { describe, expect, it } from "vitest";
import { accessSource, buildScope, canManage, canViewProject, clientLevel, intersectAccess, scopeSummary, type Actor } from "@/server/domain/access";
import { canAccessProject } from "@/server/domain/mcp-access";

const owner: Actor = { id: "o", role: "owner" };
const luis: Actor = { id: "luis", role: "admin" };
const A = "client-a";
const B = "client-b";
const C = "client-c";

describe("alcance del equipo", () => {
  it("el propietario ve todo sin necesitar compartidos", () => {
    const scope = buildScope(owner, { shares: [], ownClientIds: [] });
    expect(scope).toEqual({ all: true });
    expect(canViewProject(scope, { id: "p", clientId: "x" })).toBe(true);
  });

  it("un miembro ve sus clientes, los compartidos enteros y los proyectos sueltos, y nada más", () => {
    const scope = buildScope(luis, { ownClientIds: [A], shares: [{ clientId: B, projectId: null }, { clientId: C, projectId: "pc1" }] });
    expect(canViewProject(scope, { id: "pa1", clientId: A })).toBe(true);
    expect(canViewProject(scope, { id: "pb9", clientId: B })).toBe(true); // proyecto nuevo de un cliente compartido: entra solo
    expect(canViewProject(scope, { id: "pc1", clientId: C })).toBe(true);
    expect(canViewProject(scope, { id: "pc2", clientId: C })).toBe(false); // otro proyecto del mismo cliente: no
    expect(canViewProject(scope, { id: "pz", clientId: "otro" })).toBe(false);
  });

  it("un miembro sin nada no ve nada", () => {
    expect(canViewProject(buildScope(luis, { shares: [], ownClientIds: [] }), { id: "p", clientId: A })).toBe(false);
  });

  it("clientLevel distingue ver el cliente entero de ver solo algún proyecto suyo", () => {
    const scope = buildScope(luis, { ownClientIds: [A], shares: [{ clientId: C, projectId: "pc1" }] });
    expect(clientLevel(scope, A, ["pa1"])).toBe("full");
    expect(clientLevel(scope, C, ["pc1", "pc2"])).toBe("projects-only");
    expect(clientLevel(scope, B, ["pb1"])).toBeNull();
    expect(clientLevel({ all: true }, B, [])).toBe("full");
  });

  it("gestionar (compartir, reasignar, archivar) es del propietario y del responsable, no de quien recibe", () => {
    expect(canManage(owner, { ownerId: "otro" })).toBe(true);
    expect(canManage(luis, { ownerId: "luis" })).toBe(true);
    expect(canManage(luis, { ownerId: "otro" })).toBe(false);
    expect(canManage(luis, { ownerId: null })).toBe(false); // cliente sin responsable = del propietario
  });

  it("de dónde viene el acceso", () => {
    const scope = buildScope(luis, { ownClientIds: [A], shares: [{ clientId: B, projectId: null }, { clientId: C, projectId: "pc1" }] });
    expect(accessSource(owner, { all: true }, { id: "p", clientId: A }, { ownerId: null })).toBe("owner");
    expect(accessSource(luis, scope, { id: "pa1", clientId: A }, { ownerId: "luis" })).toBe("responsible");
    expect(accessSource(luis, scope, { id: "pb1", clientId: B }, { ownerId: "x" })).toBe("client-share");
    expect(accessSource(luis, scope, { id: "pc1", clientId: C }, { ownerId: "x" })).toBe("project-share");
    expect(accessSource(luis, scope, { id: "pc2", clientId: C }, { ownerId: "x" })).toBeNull();
  });

  it("resumen legible", () => {
    expect(scopeSummary({ all: true })).toBe("Todo");
    expect(scopeSummary({ all: false, clientIds: [], projectIds: [] })).toBe("Nada todavía");
    expect(scopeSummary({ all: false, clientIds: ["a", "b"], projectIds: ["p"] })).toBe("2 clientes · 1 proyecto suelto");
  });
});

describe("una clave de agente nunca ve más que quien la creó", () => {
  const creator = buildScope(luis, { ownClientIds: [A], shares: [{ clientId: C, projectId: "pc1" }] });

  it("el propietario no recorta; una clave con acceso total se queda con lo del creador", () => {
    expect(intersectAccess({ all: false, clientIds: [A], projectIds: [] }, { all: true })).toEqual({ all: false, clientIds: [A], projectIds: [] });
    expect(intersectAccess({ all: true }, creator)).toEqual(creator);
  });

  it("solo entra lo que permiten los dos", () => {
    const key = intersectAccess({ all: false, clientIds: [A, B], projectIds: ["pc1", "pc2", "pa1"] }, creator);
    expect(canAccessProject(key, { id: "pa5", clientId: A })).toBe(true); // cliente permitido por ambos
    expect(canAccessProject(key, { id: "pb1", clientId: B })).toBe(false); // el creador no ve B
    expect(canAccessProject(key, { id: "pc1", clientId: C })).toBe(true); // proyecto suelto permitido por ambos
    expect(canAccessProject(key, { id: "pc2", clientId: C })).toBe(false); // el creador no ve pc2
    expect(canAccessProject(key, { id: "pa1", clientId: A })).toBe(true); // proyecto de A: suelto en la clave, A entero en el creador
  });

  it("si el creador pierde un compartido, la clave lo pierde con él", () => {
    const stored = { all: false as const, clientIds: [B], projectIds: [] };
    const before = intersectAccess(stored, buildScope(luis, { ownClientIds: [], shares: [{ clientId: B, projectId: null }] }));
    const after = intersectAccess(stored, buildScope(luis, { ownClientIds: [], shares: [] }));
    expect(canAccessProject(before, { id: "pb", clientId: B })).toBe(true);
    expect(canAccessProject(after, { id: "pb", clientId: B })).toBe(false);
  });
});
