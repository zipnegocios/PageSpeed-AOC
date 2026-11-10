import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PortalTrafficView, filterHealthGroups, parseHealthFilter } from "@/app/c/_components/traffic";
import { SEO_CLIENT_EXPLAIN } from "@/server/domain/seo-client-glossary";
import type { PortalHealthGroup, PortalHealthIssue, PortalTraffic } from "@/server/services/portal-traffic";

const issue = (over: Partial<PortalHealthIssue>): PortalHealthIssue => ({ code: "title_missing", severity: "error", text: "Páginas sin título", pages: 2, added: 0, rows: [{ page: "/a", title: "Inicio", evidence: { empty: false } }, { page: "/b", title: "Contacto", evidence: { empty: true } }], more: 0, ...over });
const groups: PortalHealthGroup[] = [
  { group: "contenido", label: "Contenido", hint: "Títulos y descripciones.", errors: 1, warnings: 1, issues: [issue({}), issue({ code: "description_missing", severity: "warning", text: "Páginas sin descripción para los buscadores" })] },
  { group: "indexacion", label: "Indexación", hint: "Que Google te encuentre.", errors: 0, warnings: 1, issues: [issue({ code: "robots_missing", severity: "warning", text: "El sitio no tiene archivo robots.txt", pages: 1, rows: [{ page: "", title: "Todo el sitio", evidence: {} }] })] },
];
const data = (over: Partial<NonNullable<PortalTraffic["health"]>> = {}): PortalTraffic => ({
  days: 28,
  dashboard: null,
  titles: {},
  health: { at: new Date("2026-05-01T10:00:00Z"), pagesCrawled: 12, truncated: false, errors: 2, warnings: 3, changes: null, groups, ...over },
});
const render = (d: PortalTraffic, healthFilter: "error" | "warning" | null = null) => renderToStaticMarkup(createElement(PortalTrafficView, { data: d, section: "salud", basePath: "/c/x/y/trafico", healthFilter }));

describe("portal: salud SEO explicada al cliente", () => {
  it("cada hallazgo abierto trae qué es, por qué importa, qué hacemos y sus páginas", () => {
    const html = render(data());
    for (const word of ["Qué es", "Por qué importa", "Qué hacemos", "Páginas afectadas", "Inicio", "Contacto"]) expect(html).toContain(word);
    expect(html).toContain(SEO_CLIENT_EXPLAIN.title_missing.why);
    expect(html).toContain(">Error<");
    expect(html).toContain(">Aviso<");
    expect(html).toContain("Todo el sitio");
    expect(html).toMatch(/Son 3 tipos de problema/);
  });

  it("las cifras de errores y avisos son un selector por enlace, y el acordeón de hallazgos es exclusivo", () => {
    const html = render(data());
    expect(html).toContain("gravedad=error");
    expect(html).toContain("gravedad=aviso");
    expect(html).toContain("Errores");
    expect(html).toMatch(/<details name="hallazgo-contenido"/);
  });

  it("filtrar por gravedad deja solo esos hallazgos y rehace las cuentas del grupo", () => {
    const onlyErrors = filterHealthGroups(groups, "error");
    expect(onlyErrors.map((g) => g.group)).toEqual(["contenido"]);
    expect(onlyErrors[0]!.issues.map((i) => i.code)).toEqual(["title_missing"]);
    expect(onlyErrors[0]).toMatchObject({ errors: 1, warnings: 0 });
    const onlyWarnings = filterHealthGroups(groups, "warning");
    expect(onlyWarnings.map((g) => g.group)).toEqual(["contenido", "indexacion"]);
    expect(filterHealthGroups(groups, null)).toBe(groups);
    const html = render(data(), "error");
    expect(html).toContain("Páginas sin título");
    expect(html).not.toContain("Páginas sin descripción para los buscadores");
  });

  it("un filtro sin hallazgos (dirección escrita a mano) enseña todo en vez de una pantalla vacía", () => {
    const html = render(data({ errors: 0, groups: filterHealthGroups(groups, "warning") }), "error");
    expect(html).toContain("Páginas sin descripción para los buscadores");
    expect(html).not.toContain("Todo en orden");
  });

  it("si hay más páginas de las que se muestran, lo dice; la gravedad de la dirección se valida", () => {
    const html = render(data({ groups: [{ ...groups[0]!, issues: [issue({ pages: 63, more: 13 })] }] }));
    expect(html).toContain("Hay 13 páginas más");
    expect(parseHealthFilter("error")).toBe("error");
    expect(parseHealthFilter("aviso")).toBe("warning");
    expect(parseHealthFilter("otra")).toBeNull();
    expect(parseHealthFilter(undefined)).toBeNull();
  });
});
