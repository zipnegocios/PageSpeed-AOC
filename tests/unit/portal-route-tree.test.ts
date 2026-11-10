import { describe, expect, it } from "vitest";
import { brandSuffix, cleanTitle, humanizeSegment, pathTitle, resolveTitles } from "@/server/domain/page-title";
import { buildRouteTree, countPages, type ProfileScores, type TreeNode, type TreePage } from "@/server/domain/route-tree";
import { formatVital, vitalTone } from "@/server/domain/vitals-band";

const sc = (p: number, agentic: ProfileScores["agentic"] = null): ProfileScores => ({ scores: { performance: p, seo: 90, accessibility: 80, best_practices: 70 }, agentic });
const page = (path: string, p: number | null, improvements = 0, title = pathTitle(path)): TreePage => ({
  routeId: path,
  path,
  title,
  improvements,
  profiles: p === null ? {} : { mobile: sc(p, { passed: 2, total: 4 }) },
});
const tree = (pages: TreePage[]) => buildRouteTree(pages, pathTitle);
const paths = (nodes: TreeNode[]): string[] => nodes.flatMap((n) => [n.path, ...paths(n.children)]);

describe("árbol de rutas del portal", () => {
  it("«/» es un nodo propio primero y sin hijos; el resto cuelga de su primer segmento", () => {
    const t = tree([page("/servicios", 80), page("/", 90), page("/contacto", 70)]);
    expect(t.map((n) => n.path)).toEqual(["/", "/contacto", "/servicios"]);
    expect(t[0]!.children).toEqual([]);
    expect(t[0]!.title).toBe("Inicio");
  });

  it("una página puede ser a la vez ruta y padre", () => {
    const t = tree([page("/servicios", 80), page("/servicios/consultoria-legal", 60), page("/servicios/ingenieria-civil", 95)]);
    const s = t[0]!;
    expect(s.page?.path).toBe("/servicios");
    expect(s.children.map((c) => c.title)).toEqual(["Consultoria legal", "Ingenieria civil"]);
  });

  it("crea el padre virtual cuando solo existe la ruta hija, con el promedio de lo que contiene", () => {
    const t = tree([page("/productos/grua", 60), page("/productos/andamio", 80)]);
    expect(t).toHaveLength(1);
    const p = t[0]!;
    expect(p.page).toBeNull();
    expect(p.title).toBe("Productos");
    expect(p.group.mobile?.scores.performance).toBe(70);
    expect(p.group.mobile?.agentic).toEqual({ passed: 4, total: 8 });
    expect(p.group.desktop).toBeUndefined();
  });

  it("las mejoras suben a los padres (las propias más las de todo lo que contiene) y no a los hermanos", () => {
    const t = tree([page("/a", 80, 1), page("/a/b", 80, 2), page("/a/b/c", 80, 3), page("/z", 80, 4)]);
    const a = t.find((n) => n.path === "/a")!;
    expect(a.ownImprovements).toBe(1);
    expect(a.totalImprovements).toBe(6);
    expect(a.children[0]!.totalImprovements).toBe(5);
    expect(t.find((n) => n.path === "/z")!.totalImprovements).toBe(4);
  });

  it("una ruta no auditada dentro de un grupo cuenta como nodo con perfiles vacíos, sin romper el promedio", () => {
    const t = tree([page("/blog", null), page("/blog/x", 50)]);
    expect(t[0]!.page?.path).toBe("/blog");
    expect(t[0]!.group.mobile?.scores.performance).toBe(50);
  });

  it("ordena los hijos por título con el criterio del español y cuenta solo páginas reales", () => {
    const t = tree([page("/s/zeta", 1, 0, "Zeta"), page("/s/ápice", 1, 0, "Ápice"), page("/s/beta", 1, 0, "beta")]);
    expect(t[0]!.children.map((c) => c.title)).toEqual(["Ápice", "beta", "Zeta"]);
    expect(countPages(t)).toBe(3); // el padre /s es virtual
    expect(paths(t)).toEqual(["/s", "/s/ápice", "/s/beta", "/s/zeta"]);
  });

  it("rutas con idioma como primer segmento forman un grupo por idioma", () => {
    const t = buildRouteTree([page("/es/servicios", 80), page("/en/services", 70)], (p) => (p === "/en" ? "Inglés" : p === "/es" ? "Español" : pathTitle(p)));
    expect(t.map((n) => n.title)).toEqual(["Español", "Inglés"].sort((a, b) => a.localeCompare(b, "es")));
  });
});

describe("título de la página", () => {
  it("humaniza el último segmento y «/» es Inicio", () => {
    expect(pathTitle("/")).toBe("Inicio");
    expect(pathTitle("/servicios/consultoria-legal")).toBe("Consultoria legal");
    expect(humanizeSegment("guia_de%20obra")).toBe("Guia de obra");
    expect(humanizeSegment("%E0%A4%A")).toBe("%E0%A4%A"); // % mal formado: no rompe
  });

  it("detecta la marca repetida al final de los títulos y la quita", () => {
    const titles = ["Consultoría legal | Tecnostar", "Ingeniería civil | Tecnostar", "Contacto - Tecnostar", "Sin separador"];
    expect(brandSuffix(titles)).toBe("tecnostar");
    expect(cleanTitle("Consultoría legal | Tecnostar", "tecnostar")).toBe("Consultoría legal");
    expect(cleanTitle("Solo la marca | Tecnostar", null)).toBe("Solo la marca | Tecnostar");
    // Un título que es solo la marca no se deja vacío.
    expect(cleanTitle("Tecnostar | Tecnostar", "tecnostar")).toBe("Tecnostar");
  });

  it("una sola página tampoco pierde su título salvo que el sufijo sea el nombre del sitio", () => {
    expect(brandSuffix(["Obras | Otra cosa"])).toBeNull();
    expect(brandSuffix(["Obras | Tecnostar"], "Tecnostar")).toBe("tecnostar");
  });

  it("prioridad: etiqueta manual, título del rastreo limpio, ruta; «/» ignora el rastreo", () => {
    const m = resolveTitles(
      [
        { path: "/", label: null, crawlTitle: "Tecnostar | Obras" },
        { path: "/a", label: "  Servicios  ", crawlTitle: "Otro | Tecnostar" },
        { path: "/b", label: null, crawlTitle: "Ingeniería civil | Tecnostar" },
        { path: "/c", label: null, crawlTitle: "Contacto | Tecnostar" },
        { path: "/d-e", label: null, crawlTitle: null },
      ],
      "Tecnostar",
    );
    expect(m.get("/")).toBe("Inicio");
    expect(m.get("/a")).toBe("Servicios");
    expect(m.get("/b")).toBe("Ingeniería civil");
    expect(m.get("/c")).toBe("Contacto");
    expect(m.get("/d-e")).toBe("D e");
  });

  it("recorta los títulos largos", () => {
    const long = "x".repeat(100);
    expect(resolveTitles([{ path: "/a", label: long, crawlTitle: null }]).get("/a")!.length).toBe(60);
  });
});

describe("bandas de métricas web", () => {
  it("LCP, CLS y TBT con los umbrales de Google", () => {
    expect(vitalTone("lcp", 2500)).toBe("ok");
    expect(vitalTone("lcp", 2501)).toBe("warning");
    expect(vitalTone("lcp", 4001)).toBe("danger");
    expect(vitalTone("cls", 0.1)).toBe("ok");
    expect(vitalTone("cls", 0.26)).toBe("danger");
    expect(vitalTone("tbt", 600)).toBe("warning");
    expect(vitalTone("tbt", null)).toBeNull();
  });
  it("formatea en español", () => {
    expect(formatVital("lcp", 2400)).toBe("2,4 s");
    expect(formatVital("lcp", 3000)).toBe("3 s");
    expect(formatVital("cls", 0.0123)).toBe("0,01");
    expect(formatVital("tbt", 119.6)).toBe("120 ms");
    expect(formatVital("lcp", null)).toBe("—");
  });
});
