import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CrawlSection } from "@/app/admin/seo/_components/crawl-section";
import type { CrawlReport, CrawlRunView } from "@/server/services/seo-crawl";

vi.mock("@/app/admin/seo/actions", () => ({ requestCrawlAction: async () => ({}) }));

const NOW = Date.now();
const run = (over: Partial<CrawlRunView> = {}): CrawlRunView => ({
  id: "r1", status: "succeeded", trigger: "manual", queuedAt: new Date(NOW - 3 * 3_600_000), startedAt: new Date(NOW - 3 * 3_600_000), finishedAt: new Date(NOW - 3 * 3_600_000 + 240_000),
  outcome: "complete", detail: null, pagesCrawled: 120, pagesDiscovered: 120, truncatedBy: null, errors: 2, warnings: 3, infos: 1, ...over,
});
const empty: CrawlReport = { active: null, latest: null, current: null, previous: null, markets: [], lang: null, counts: null, previousCounts: null, changes: null, groups: [], detail: null, history: [] };
const withData = (over: Partial<CrawlReport> = {}): CrawlReport => ({
  ...empty,
  latest: run(),
  current: run(),
  previous: run({ id: "r0", queuedAt: new Date(NOW - 7 * 86_400_000), finishedAt: new Date(NOW - 7 * 86_400_000 + 200_000) }),
  counts: { error: 2, warning: 3, info: 1 },
  previousCounts: { error: 4, warning: 3, info: 0 },
  changes: { added: 3, resolved: 5 },
  groups: [
    { code: "title_missing", severity: "error", group: "contenido", title: "Sin título", advice: "Añade un <title> descriptivo y único.", pages: 2, added: 1 },
    { code: "h1_missing", severity: "warning", group: "contenido", title: "Sin h1", advice: "Añade un encabezado h1.", pages: 3, added: 0 },
  ],
  ...over,
});
const render = (report: CrawlReport, search = {}) => renderToStaticMarkup(<CrawlSection projectId="p1" report={report} basePath="/admin/clientes/acme/tienda/seo" search={search} />);

describe("sección «Auditoría técnica»", () => {
  it("sin ningún rastreo explica cómo empezar", () => {
    const html = render(empty);
    expect(html).toContain("Auditoría técnica");
    expect(html).toContain("Todavía no se ha rastreado este sitio");
    expect(html).toContain("Rastrear ahora");
    expect(html).not.toContain("Hallazgos por tipo");
  });

  it("en cola o en curso, lo dice y pide recargar", () => {
    const queued = render({ ...empty, active: run({ status: "queued", startedAt: null }), latest: run({ status: "queued" }) });
    expect(queued).toContain("esperando su turno");
    expect(queued).toContain("Recarga la página");
    const running = render({ ...empty, active: run({ status: "running" }), latest: run({ status: "running" }) });
    expect(running).toContain("en curso, iniciado hace 3 h");
  });

  it("con datos muestra cifras, variación, nuevos y resueltos, y el estado del rastreo", () => {
    const html = render(withData());
    expect(html).toContain("Errores");
    expect(html).toContain("Avisos");
    expect(html).toContain("Información");
    expect(html).toContain("2 hallazgos"); // los errores bajaron de 4 a 2
    expect(html).toContain("mejoró");
    // Que suban los hallazgos informativos no es un empeoramiento: no lleva variación.
    expect(html).not.toContain("empeoró");
    expect(html).toContain("120 páginas revisadas");
    expect(html).toContain("3 nuevos y 5 resueltos");
    expect(html).toContain("Completo");
    expect(html).toContain("a pedido");
    expect(html).toContain("Hace 2 h");
    expect(html).toContain("Sin título");
    expect(html).toContain("Añade un &lt;title&gt; descriptivo y único.");
  });

  it("sin rastreo anterior dice que no hay con qué comparar", () => {
    const html = render(withData({ previous: null, previousCounts: null, changes: null }));
    expect(html).toContain("primer rastreo");
    expect(html).not.toContain("resueltos");
  });

  it("los enlaces a cada hallazgo conservan los parámetros de otros paneles de la página", () => {
    const html = render(withData(), { periodo: "7", idioma: "en", ruta: "r1" });
    expect(html).toContain("periodo=7");
    expect(html).toContain("idioma=en");
    expect(html).toContain("ruta=r1");
    expect(html).toContain("hallazgo=title_missing");
    expect(html).toContain("#auditoria-tecnica");
  });

  it("un rastreo parcial avisa de lo que no se evaluó", () => {
    const partial = run({ status: "partial", truncatedBy: "pages", detail: "Se alcanzó el máximo de 300 páginas; los resultados son parciales." });
    const html = render(withData({ current: partial, latest: partial }));
    expect(html).toContain("Parcial");
    expect(html).toContain("máximo de 300 páginas");
    expect(html).toContain("páginas huérfanas");
  });

  it("si el último rastreo falló, muestra el motivo y sigue mostrando los resultados anteriores", () => {
    const html = render(withData({ latest: run({ id: "r2", status: "failed", outcome: "blocked_by_site", detail: "El sitio rechaza al rastreador (403 o 429). Permite el agente PageSpeedAOC-SEO." }) }));
    expect(html).toContain("El último rastreo no pudo terminar");
    expect(html).toContain("PageSpeedAOC-SEO");
    expect(html).toContain("Hallazgos por tipo");
    expect(html).toContain("resultados del último rastreo que terminó");
  });

  it("si el único rastreo falló, muestra el motivo y ninguna cifra", () => {
    const failed = run({ status: "failed", detail: "La portada del sitio no responde.", pagesCrawled: 0 });
    const html = render({ ...empty, latest: failed });
    expect(html).toContain("La portada del sitio no responde.");
    expect(html).toContain("Fallido");
    expect(html).not.toContain("Hallazgos por tipo");
    expect(html).not.toContain("Errores");
  });

  it("un sitio sin hallazgos lo celebra; filtrado por idioma, lo dice de otra forma", () => {
    expect(render(withData({ groups: [], counts: { error: 0, warning: 0, info: 0 } }))).toContain("no encontró ningún problema");
    expect(render(withData({ groups: [], counts: { error: 0, warning: 0, info: 0 }, lang: "en" }))).toContain("No hay hallazgos en este idioma");
  });

  it("con idiomas declarados ofrece el selector, con «Todos»; «Sin idioma» solo si no hay uno por defecto", () => {
    const markets = [{ lang: "en", prefix: "/en", isDefault: false, label: "Inglés" }];
    const html = render(withData({ markets, lang: "en" }));
    expect(html).toContain("Todos");
    expect(html).toContain("Inglés");
    expect(html).toContain("Sin idioma");
    const withDefault = render(withData({ markets: [{ lang: "es", prefix: "/", isDefault: true, label: "Español" }, ...markets] }));
    expect(withDefault).not.toContain("Sin idioma");
    expect(render(withData())).not.toContain("Todos");
  });

  it("el detalle lista las páginas con la evidencia, marca las nuevas y se puede cerrar", () => {
    const detail = {
      code: "broken_link" as const, severity: "error" as const, title: "Enlace interno roto", advice: "Corrige el enlace.", more: 12,
      rows: [
        { page: "/rota", lang: "es", evidence: { count: 2, from: ["/", "/a"], status: 404 }, isNew: true },
        { page: "/<script>alert(1)</script>", lang: null, evidence: { count: 1, from: ["/"], status: 410 }, isNew: false },
      ],
    };
    const html = render(withData({ detail }));
    expect(html).toContain("Páginas afectadas");
    expect(html).toContain("la enlazan 2 páginas: /, /a");
    expect(html).toContain("Nuevo");
    expect(html).toContain("Cerrar detalle");
    expect(html).toContain("faltan 12 más");
    // El contenido del sitio auditado nunca se interpreta como HTML.
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("un hallazgo del sitio entero se muestra como «Todo el sitio»", () => {
    const detail = { code: "robots_missing" as const, severity: "warning" as const, title: "Sin robots.txt", advice: "Crea uno.", more: 0, rows: [{ page: "", lang: null, evidence: {}, isNew: false }] };
    expect(render(withData({ detail }))).toContain("Todo el sitio");
  });
});
