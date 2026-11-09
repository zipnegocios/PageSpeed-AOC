import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DataTable } from "@/app/admin/seo/_components/data-table";
import { SeoChart } from "@/app/admin/seo/_components/seo-chart";
import { layoutSeries } from "@/lib/seo-chart-layout";
import { ctrDelta, formatCount, formatPercent, formatPosition, percentDelta, positionDelta } from "@/lib/seo-format";

const series = (values: number[]) => values.map((value, i) => ({ date: `2026-06-${String(i + 1).padStart(2, "0")}`, value }));

describe("formatos y variaciones de «Tráfico y búsqueda»", () => {
  it("números y porcentajes en español, con separador de miles también en cuatro cifras", () => {
    expect(formatCount(6880)).toBe("6.880");
    expect(formatCount(257343)).toBe("257.343");
    expect(formatPercent(0.104)).toContain("10,4");
    expect(formatPosition(7.123)).toBe("7,1");
    expect(formatPosition(null)).toBe("—");
  });
  it("variación porcentual: mejora, empeora, sin cambio y sin base", () => {
    expect(percentDelta(150, 100)).toMatchObject({ direction: "up", verdict: "better", text: "50,0 %" });
    expect(percentDelta(50, 100)).toMatchObject({ direction: "down", verdict: "worse" });
    expect(percentDelta(100, 100)).toMatchObject({ verdict: "same" });
    expect(percentDelta(10, 0)).toBeNull();
  });
  it("la posición media mejora al bajar el número", () => {
    expect(positionDelta(4.2, 5.5)).toMatchObject({ direction: "down", verdict: "better", text: "1,3 posiciones" });
    expect(positionDelta(6, 5)).toMatchObject({ direction: "up", verdict: "worse", text: "1,0 posición" });
    expect(positionDelta(null, 5)).toBeNull();
  });
  it("CTR en puntos porcentuales", () => {
    expect(ctrDelta(0.05, 0.03)).toMatchObject({ verdict: "better", text: "2,0 puntos" });
    expect(ctrDelta(0.03, 0.03)).toMatchObject({ verdict: "same" });
  });
});

describe("gráfico diario", () => {
  it("el eje parte de cero y llega a un máximo por encima del pico", () => {
    const l = layoutSeries(series([3, 10, 0, 7]));
    expect(l.yTicks[0]).toEqual({ y: 0, label: "0" });
    expect(l.max).toBeGreaterThanOrEqual(10);
    expect(l.peak).toEqual({ date: "2026-06-02", value: 10 });
    expect(l.total).toBe(20);
    expect(l.points[0]!.x).toBe(0);
    expect(l.points.at(-1)!.x).toBe(100);
  });
  it("una serie toda en cero no tiene pico y no rompe la escala", () => {
    const l = layoutSeries(series([0, 0, 0]));
    expect(l.peak).toBeNull();
    expect(l.max).toBeGreaterThan(0);
  });
  it("se pinta con título accesible, resumen en texto y sin hex sueltos", () => {
    const html = renderToStaticMarkup(<SeoChart title="Clics por día" unit="clics" series={series([3, 10, 0, 7])} />);
    expect(html).toContain('role="img"');
    expect(html).toContain("Clics por día");
    expect(html).toContain("Total 20 clics. Máximo: 10 el 2 jun 2026.");
    expect(html).toContain("stroke-chart-1");
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });
  it("la segunda serie se distingue también por el trazo discontinuo", () => {
    expect(renderToStaticMarkup(<SeoChart title="Sesiones por día" unit="sesiones" series={series([1, 2])} tone={2} />)).toContain("stroke-dasharray");
  });
});

describe("tabla de ranking", () => {
  const columns = [
    { header: "Página", mono: true, cell: (r: { p: string; n: number }) => r.p },
    { header: "Clics", numeric: true, cell: (r: { p: string; n: number }) => r.n },
  ];
  it("con filas, pinta encabezados y celdas", () => {
    const html = renderToStaticMarkup(<DataTable title="Páginas" columns={columns} rows={[{ p: "/a", n: 3 }]} rowKey={(r) => r.p} empty="vacío" />);
    expect(html).toContain('scope="col"');
    expect(html).toContain("/a");
    expect(html).not.toContain("vacío");
  });
  it("sin filas, dice qué hacer", () => {
    const html = renderToStaticMarkup(<DataTable title="Páginas" columns={columns} rows={[]} rowKey={(r) => r.p} empty="Pulsa «Actualizar ahora»." />);
    expect(html).toContain("Pulsa «Actualizar ahora».");
    expect(html).not.toContain("<table");
  });
});
