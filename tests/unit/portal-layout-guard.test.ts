import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ImprovementList } from "@/app/c/_components/improvement-list";
import { MeasurementCards } from "@/app/c/_components/measurement-cards";
import { reportData } from "../helpers/report-data";
import { ReportCards } from "@/app/c/_components/report-cards";
import { PortalRouteTree } from "@/app/c/_components/route-tree";
import type { PortalImprovements, PortalTreeNode } from "@/server/services/portal";

/**
 * Guardas contra el desborde horizontal en el teléfono. Una rejilla sin `grid-cols-*` base (los `xl:` o `md:` no cuentan: en el teléfono no aplican) crea una columna implícita `auto` que no
 * baja de la anchura mínima de su contenido: un título largo en una sola línea la ensancha más que la pantalla, la página se hace
 * más ancha, Safari de iPhone la encoge y las barras fijas dejan de verse ancladas (reportado en Rutas y Mejoras).
 */

const ROOT = join(process.cwd(), "src", "app", "c");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".tsx") ? [p] : [];
  });
}

describe("portal: guardas de maquetación móvil", () => {
  it("ninguna rejilla del portal queda sin columnas declaradas", () => {
    const offenders: string[] = [];
    for (const file of files(ROOT)) {
      const source = readFileSync(file, "utf8");
      for (const m of source.matchAll(/(?:className=\{?|cx\()\s*(?:"([^"]*)"|`([^`]*)`)/g)) {
        const tokens = (m[1] ?? m[2] ?? "").split(/\s+/).filter(Boolean);
        if (tokens.includes("grid") && !tokens.some((t) => t.startsWith("grid-cols-") || t.startsWith("grid-template"))) offenders.push(`${file.replace(process.cwd() + "/", "")}: ${tokens.join(" ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  const LONG = "Consultoría legal para contratos de obra pública y concesiones de infraestructura".slice(0, 60);
  const metrics = { lcpMs: 2000, cls: 0.02, tbtMs: 100 };
  const view = { scores: { performance: 60, seo: 90, accessibility: 80, best_practices: 100 }, agentic: { passed: 500, total: 800 }, auditId: "a", finishedAt: new Date("2026-11-03T12:00:00Z"), metrics, changes: { performance: null, seo: null, accessibility: null, best_practices: null } };
  const node = (path: string): PortalTreeNode => ({ path, title: LONG, page: { routeId: path, path, title: LONG, improvements: 1, profiles: { mobile: view as never } }, children: [], ownImprovements: 1, totalImprovements: 1, group: {} });

  it("el árbol de rutas usa una columna `minmax(0, 1fr)`, elementos que se encogen y títulos que envuelven (no `truncate`)", () => {
    const html = renderToStaticMarkup(createElement(PortalRouteTree, { nodes: [node("/a"), node("/b")], base: "/c/x/y" }));
    expect(html).toContain("grid-cols-1");
    expect(html).toMatch(/<li class="min-w-0">/);
    const title = /<span class="([^"]*)">Consultoría legal para contratos/.exec(html)?.[1] ?? "";
    expect(title).toContain("min-w-0");
    expect(title).toContain("line-clamp-2");
    expect(title).not.toContain("truncate");
  });

  it("las mejoras y las tarjetas de informes hacen lo mismo", () => {
    const data: PortalImprovements = { total: 1, pages: [{ path: "/a", title: LONG, blocks: [{ profile: "mobile", kind: "threshold", category: "performance", value: 50, threshold: 85, auditId: "a", items: [{ id: "x", text: "Hay archivos que retrasan que la página empiece a verse", impact: "≈ 1,9 s" }] }] }] };
    const improvements = renderToStaticMarkup(createElement(ImprovementList, { data, base: "/c/x/y" }));
    expect(improvements).toContain("grid-cols-1");
    expect(improvements).toMatch(/<li class="min-w-0">/);
    expect(improvements).not.toMatch(/truncate[^"]*">Consultoría/);
    const reports = renderToStaticMarkup(createElement(ReportCards, { base: "/c/x/y", days: 30, states: { speed: "included", improvements: "included", field: "included", search: "off", traffic: "off", sources: "off", ai: "off", health: "pending" } }));
    expect(reports).toContain("grid-cols-1");
    // Cada apartado nombra si está incluido, sin datos o no activado.
    expect(reports).toContain("Incluido");
    expect(reports).toContain("No activado");
    expect(reports).toContain("Aún sin datos");
  });

  it("las micro-tarjetas del Resumen usan rejilla con columnas base y celdas que se encogen", () => {
    const m = { days: 28, seoAccess: true, traffic: null, field: null, fields: [], states: { speed: "included", improvements: "included", field: "pending", search: "pending", traffic: "pending", sources: "pending", ai: "pending", health: "pending" } } as const;
    const html = renderToStaticMarkup(createElement(MeasurementCards, { m: m as never, base: "/c/x/y" }));
    expect(html).toContain("Todavía sin datos");
    const full = renderToStaticMarkup(createElement(MeasurementCards, { m: { ...m, traffic: reportData("summary").seo, fields: reportData("summary").fields, field: reportData("summary").fields[0]! } as never, base: "/c/x/y" }));
    expect(full).toMatch(/<ul class="grid grid-cols-2[^"]*">/);
    expect(full).toMatch(/<li class="min-w-0">/);
    expect(full).toContain("Redes sociales");
    expect(full).toContain("Instagram");
  });
});
