import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/lang/route";

const call = (qs: string, headers: Record<string, string> = {}) => GET(new Request(`http://0.0.0.0:3000/api/lang?${qs}`, { headers }));

describe("/api/lang", () => {
  it("guarda el idioma y vuelve a la página con una redirección relativa", () => {
    const res = call(`set=en&back=${encodeURIComponent("/admin/auditorias/x?vista=seo")}`);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/admin/auditorias/x?vista=seo");
    expect(res.headers.get("set-cookie")).toMatch(/^aoc_lang=en; Path=\/; Max-Age=31536000; SameSite=Lax; HttpOnly$/);
  });
  it("un idioma desconocido cae en español", () => {
    expect(call("set=fr&back=/").headers.get("set-cookie")).toContain("aoc_lang=es");
    expect(call("back=/").headers.get("set-cookie")).toContain("aoc_lang=es");
  });
  it("solo vuelve a rutas internas (nada de redirecciones abiertas ni inyección de cabeceras)", () => {
    for (const back of ["https://evil.test", "//evil.test", "/\\evil.test", "javascript:alert(1)", "/ok\r\nSet-Cookie: x=1"]) {
      expect(call(`set=es&back=${encodeURIComponent(back)}`).headers.get("location"), back).toBe("/");
    }
  });
  it("detrás del proxy con HTTPS marca la cookie como Secure", () => {
    expect(call("set=es&back=/", { "x-forwarded-proto": "https" }).headers.get("set-cookie")).toMatch(/; Secure$/);
  });
});
