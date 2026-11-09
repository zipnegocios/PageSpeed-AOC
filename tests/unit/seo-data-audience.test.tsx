import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SeoDataSection } from "@/app/_components/seo/seo-data-section";
import type { SeoDashboard } from "@/server/services/seo-data";

const range = { from: "2026-06-03", to: "2026-06-30", days: 28 };
const prev = { from: "2026-05-06", to: "2026-06-02", days: 28 };
const totals = { clicks: 120, impressions: 4000, ctr: 0.03, position: 8.4 };

const withData: SeoDashboard = {
  range,
  previous: prev,
  sync: {
    gsc: { status: "error", syncedThrough: "2026-06-27", lastSyncAt: new Date("2026-06-30T05:37:00Z"), detail: "Google rechazó la cuenta de servicio (403 PERMISSION_DENIED)" },
    ga4: { status: "ok", syncedThrough: "2026-06-29", lastSyncAt: new Date("2026-06-30T05:37:00Z"), detail: null },
  },
  markets: [],
  lang: null,
  languages: null,
  search: {
    range,
    previous: prev,
    totals,
    previousTotals: { ...totals, clicks: 100 },
    daily: [{ date: "2026-06-27", clicks: 5, impressions: 50 }],
    topPages: [{ page: "/es/precios", clicks: 50, impressions: 900, ctr: 0.05, position: 4 }],
    countries: [],
    devices: [],
  },
  traffic: null,
  ai: null,
};

const render = (audience: "admin" | "client", d: SeoDashboard = withData) =>
  renderToStaticMarkup(<SeoDataSection dashboard={d} days={28} basePath="/c/acme/tienda" search={{ dias: "90", ruta: "r1" }} audience={audience} syncForm={<button>Actualizar ahora</button>} />);

describe("«Tráfico y búsqueda» según quién mira", () => {
  it("el administrador ve el estado de la descarga, el error técnico y el botón", () => {
    const html = render("admin");
    expect(html).toContain("Con error");
    expect(html).toContain("PERMISSION_DENIED");
    expect(html).toContain("Actualizar ahora");
  });

  it("el cliente ve los datos y hasta qué día llegan, pero ni errores, ni estados, ni botones", () => {
    const html = render("client");
    expect(html).toContain("Páginas con más clics");
    expect(html).toContain("/es/precios");
    expect(html).toContain("hasta el");
    expect(html).not.toContain("Con error");
    expect(html).not.toContain("PERMISSION_DENIED");
    expect(html).not.toContain("Actualizar ahora");
    expect(html).not.toContain("más abajo");
  });

  it("los enlaces conservan los parámetros de otros paneles de la pantalla", () => {
    const html = render("client");
    expect(html).toContain("dias=90");
    expect(html).toContain("ruta=r1");
    expect(html).toContain("periodo=7");
  });

  it("sin datos, al cliente se le explica con calma y sin instrucciones para el administrador", () => {
    const empty: SeoDashboard = { ...withData, range: null, previous: null, search: null };
    const html = render("client", empty);
    expect(html).toContain("Estamos reuniendo la información");
    expect(html).not.toContain("Actualizar ahora");
  });
});
