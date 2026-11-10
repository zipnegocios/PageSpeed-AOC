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
    devices: [], topQueries: [],
  },
  traffic: null,
  ai: null, sources: null, social: null,
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

describe("visitas desde IA: mínimo observado", () => {
  const totals = { sessions: 200, users: 150 };
  const withAi: SeoDashboard = {
    ...withData,
    traffic: { range, previous: prev, totals, previousTotals: { sessions: 180, users: 130 }, daily: [{ date: "2026-06-29", sessions: 7 }], channels: [], topPages: [], countries: [] },
    ai: {
      range,
      previous: prev,
      totals: { sessions: 5, users: 5 },
      previousTotals: { sessions: 2, users: 2 },
      bySource: [{ source: "chatgpt.com", sessions: 5 }],
      topPages: [{ page: "/es/precios", sessions: 5 }],
    },
  };

  for (const audience of ["admin", "client"] as const) {
    it(`${audience}: la cifra y la sección se presentan como mínimo, con su explicación y su peso en las sesiones`, () => {
      const html = render(audience, withAi);
      expect(html).toContain("Visitas desde asistentes de IA");
      expect(html).toContain("Mínimo observado");
      expect(html).toContain("2,5 % de las sesiones"); // 5 de 200
      expect(html).toContain("Es un mínimo");
      expect(html).toContain("tráfico directo");
      expect(html).toContain("ChatGPT, Perplexity, Claude, Gemini o Copilot");
      expect(html).toContain("chatgpt.com");
      // Nunca se presenta como total.
      expect(html).not.toContain("Total de visitas desde IA");
    });
  }

  it("sin visitas desde IA, la cifra es 0 y sigue diciendo que es un mínimo; sin GA4 no inventa el peso en las sesiones", () => {
    const none = render("client", { ...withAi, ai: null });
    expect(none).toContain("Mínimo observado");
    expect(none).not.toContain("de las sesiones");
    const noGa4 = render("client", { ...withData });
    expect(noGa4).not.toContain("de las sesiones");
  });
});
