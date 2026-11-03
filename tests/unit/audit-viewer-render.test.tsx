import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import real from "../fixtures/lhr-viewer.json";
import { AuditViewer } from "@/app/_components/audit-viewer/viewer";
import { DetailsBlock } from "@/app/_components/audit-viewer/details-block";
import { InlineText } from "@/app/_components/audit-viewer/inline-text";
import { localizeLhr } from "@/server/report/lighthouse-report";
import type { DetailsView, Lhr } from "@/server/domain/lhr-view";

const lhr = localizeLhr(real as unknown as Lhr, "es");
const render = (search: Record<string, string> = {}, over: { evidence?: string | null; report?: string | null } = {}) =>
  renderToStaticMarkup(
    <AuditViewer
      lhr={lhr}
      locale="es"
      basePath="/x/y"
      search={search}
      evidenceImageSrc={over.evidence === undefined ? "/img" : over.evidence}
      reportSrc={over.report === undefined ? "/rep" : over.report}
    />,
  );

describe("visor de auditoría (render en servidor)", () => {
  it("pestañas con su nota y enlaces que conservan la ruta base", () => {
    const html = render();
    for (const label of ["Resumen", "Rendimiento 100", "Accesibilidad 95", "Buenas prácticas 96", "SEO 100", "Evidencias", "Informe completo"]) expect(html).toContain(label);
    expect(html).toContain('href="/x/y?vista=rendimiento"');
    expect(html).toContain('aria-current="page"');
  });
  it("sin evidencias ni informe esas pestañas no existen (rutas con sesión vistas por el cliente)", () => {
    const html = render({}, { evidence: null, report: null });
    expect(html).not.toContain("Evidencias");
    expect(html).not.toContain("Informe completo");
    // y aunque pidan la pestaña por URL, se cae al resumen
    expect(render({ vista: "evidencias" }, { evidence: null })).toContain("Categorías");
  });
  it("una pestaña desconocida cae en el resumen y la de rendimiento muestra métricas y filtros", () => {
    expect(render({ vista: "no-existe" })).toContain("Categorías");
    const html = render({ vista: "rendimiento", m: "LCP" });
    expect(html).toContain("Métricas");
    expect(html).toMatch(/href="\/x\/y\?vista=rendimiento&amp;m=FCP"/);
    expect(html).toContain("Ampliar todo");
  });
  it("ampliar todo abre las filas y los grupos plegados llevan su conteo", () => {
    const closed = render({ vista: "accesibilidad" });
    const open = render({ vista: "accesibilidad", expandir: "1" });
    expect((open.match(/<details open/g) ?? []).length).toBeGreaterThan((closed.match(/<details open/g) ?? []).length);
    expect(closed).toMatch(/Auditorías aprobadas \(\d+\)/);
    expect(closed).toContain("Contraer todo".replace("Contraer", "Ampliar"));
  });
  it("cada auditoría con estado lleva su palabra para lectores de pantalla", () => {
    const html = render({ vista: "accesibilidad" });
    expect(html).toMatch(/class="sr-only">(deficiente|mejorable|informativo)</);
  });
  it("la pestaña de evidencias dibuja recuadros y la lista numerada", () => {
    const html = render({ vista: "evidencias" });
    expect(html).toContain('src="/img"');
    expect(html).toContain("border-danger");
    expect(html).toContain("<ol");
  });
});

describe("texto y detalles de Lighthouse no inyectan HTML", () => {
  it("InlineText escapa etiquetas y solo enlaza http(s)", () => {
    const html = renderToStaticMarkup(<InlineText text={'<img src=x onerror=alert(1)> [malo](javascript:alert(1)) [bueno](https://web.dev)'} />);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain('href="javascript');
    expect(html).toContain('href="https://web.dev" target="_blank" rel="noopener noreferrer"');
  });
  it("un elemento con fragmento malicioso se muestra como texto", () => {
    const d: DetailsView = { t: "node", cell: { k: "node", label: "<script>alert(1)</script>", selector: "div > <b>", snippet: '<a href="javascript:alert(1)" onclick="x()">', lhId: null } };
    const html = renderToStaticMarkup(<DetailsBlock details={d} />);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<a href");
    expect(html).toContain("&lt;script&gt;");
  });
  it("una celda de enlace con esquema no http no se vuelve enlace", () => {
    const d: DetailsView = { t: "table", headings: [{ key: "l", label: "L", right: false }], rows: [{ cells: { l: { k: "link", url: "javascript:alert(1)", text: "x" } }, sub: [] }], hidden: 0, subHeadings: [] };
    expect(renderToStaticMarkup(<DetailsBlock details={d} />)).not.toContain("javascript:");
  });
  it("las miniaturas solo aceptan imágenes en data:", () => {
    const d: DetailsView = { t: "table", headings: [{ key: "t", label: "T", right: false }], rows: [{ cells: { t: { k: "thumb", src: "data:image/png;base64,AAAA" } }, sub: [] }], hidden: 0, subHeadings: [] };
    expect(renderToStaticMarkup(<DetailsBlock details={d} />)).toContain('src="data:image/png;base64,AAAA"');
  });
});
