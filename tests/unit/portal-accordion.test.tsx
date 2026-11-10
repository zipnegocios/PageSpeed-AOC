import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ImprovementList } from "@/app/c/_components/improvement-list";
import { PortalRouteTree } from "@/app/c/_components/route-tree";
import { TabIcon } from "@/app/c/_components/portal-icons";
import type { PortalImprovements, PortalTreeNode } from "@/server/services/portal";

/** Un solo desplegable abierto a la vez (atributo nativo `name`) y todo contraído de entrada. */
describe("portal: acordeones", () => {
  const items = [{ id: "a", text: "Hay archivos que retrasan la carga", impact: "≈ 1,9 s" }];
  const page = (path: string) => ({ path, title: path, blocks: [{ profile: "mobile" as const, kind: "threshold" as const, category: "performance" as const, value: 50, threshold: 85, auditId: "x", items }] });
  const data: PortalImprovements = { total: 2, pages: [page("/a"), page("/b")] };

  it("las mejoras vienen contraídas, incluida la primera, y forman un acordeón exclusivo", () => {
    const html = renderToStaticMarkup(createElement(ImprovementList, { data, base: "/c/x/y" }));
    expect(html).not.toMatch(/<details[^>]*\bopen/);
    expect(html.match(/<details[^>]*name="mejoras"/g)).toHaveLength(2);
  });

  const view = { scores: { performance: 60, seo: 90, accessibility: 80, best_practices: 100 }, agentic: null, auditId: "a", finishedAt: new Date("2026-11-03T12:00:00Z"), metrics: { lcpMs: 2000, cls: 0.02, tbtMs: 100 }, changes: { performance: null, seo: null, accessibility: null, best_practices: null } };
  const node = (path: string, children: PortalTreeNode[] = [], improvements = 1): PortalTreeNode => ({ path, title: path, page: { routeId: path, path, title: path, improvements, profiles: { mobile: view as never } }, children, ownImprovements: 0, totalImprovements: improvements, group: {} });

  it("las rutas parten contraídas aunque tengan mejoras dentro, y cada nivel es su propio acordeón", () => {
    const html = renderToStaticMarkup(createElement(PortalRouteTree, { nodes: [node("/a", [node("/a/x"), node("/a/y")]), node("/b")], base: "/c/x/y" }));
    expect(html).not.toMatch(/<details[^>]*\bopen/);
    expect(html.match(/name="rutas-raiz"/g)).toHaveLength(2);
    expect(html.match(/name="rutas-\/a"/g)).toHaveLength(2);
  });

  it("los iconos de las pestañas tienen versión de línea y versión rellena", () => {
    for (const id of ["resumen", "rutas", "mejoras", "trafico", "informes"] as const) {
      expect(renderToStaticMarkup(createElement(TabIcon, { id }))).toContain('fill="none"');
      expect(renderToStaticMarkup(createElement(TabIcon, { id, active: true }))).toContain('fill="currentColor"');
    }
  });
});

describe("portal: lista de causas expandible", () => {
  const many = Array.from({ length: 14 }, (_, i) => ({ id: `c${i}`, text: `Causa número ${i + 1}`, impact: i === 0 ? "≈ 1,9 s" : "" }));
  const page = { path: "/a", title: "Consultoría legal", blocks: [{ profile: "mobile" as const, kind: "threshold" as const, category: "performance" as const, value: 48, threshold: 85, auditId: "x", items: many }] };

  it("enseña las 5 primeras numeradas, el botón va debajo de la lista y dice cuántas faltan", () => {
    const html = renderToStaticMarkup(createElement(ImprovementList, { data: { total: 1, pages: [page] }, base: "/c/x/y" }));
    for (let n = 1; n <= 5; n++) expect(html).toContain(`Causa número ${n}<`);
    expect(html).not.toContain("Causa número 6<");
    expect(html.indexOf("Ver las 9 restantes")).toBeGreaterThan(html.indexOf("Causa número 5<"));
    expect(html).toContain("14 causas en total");
  });

  it("con 5 o menos no hay botón", () => {
    const few = { ...page, blocks: [{ ...page.blocks[0]!, items: many.slice(0, 5) }] };
    const html = renderToStaticMarkup(createElement(ImprovementList, { data: { total: 1, pages: [few] }, base: "/c/x/y" }));
    expect(html).not.toContain("restantes");
    expect(html).not.toContain("causas en total");
  });
});
