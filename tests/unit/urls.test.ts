import { describe, expect, it } from "vitest";
import { clientPath, portalProjectPath, projectPath } from "@/lib/urls";

describe("direcciones legibles", () => {
  it("arman el panel con slugs, anidando el proyecto bajo su cliente", () => {
    expect(clientPath("acme")).toBe("/admin/clientes/acme");
    expect(projectPath("acme", "tienda")).toBe("/admin/clientes/acme/tienda");
  });
  it("el portal usa el token del cliente y el slug del proyecto", () => {
    expect(portalProjectPath("tok", "tienda")).toBe("/c/tok/tienda");
  });
});
