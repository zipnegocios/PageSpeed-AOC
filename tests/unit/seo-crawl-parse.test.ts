import { describe, expect, it } from "vitest";
import { hasNoindex, parseHtml, parseRobotsHeader } from "@/server/domain/seo-crawl-parse";

const URL0 = "https://acme.test/es/precios";
const page = (head: string, body = "<h1>Hola</h1>" + "<p>texto</p>".repeat(20)) => `<!doctype html><html lang="es"><head>${head}</head><body>${body}</body></html>`;

describe("lectura de una página", () => {
  it("extrae título, descripción, h1, canónica, lang y robots", () => {
    const f = parseHtml(
      page(`<title>  Precios &amp;\n  planes </title><meta name="description" content="  Todo   sobre &quot;precios&quot; "><link rel="canonical" href="/es/precios/"><meta name="robots" content="Noindex, Follow"><meta name="googlebot" content="noarchive">`),
      URL0,
    );
    expect(f.title).toBe("Precios & planes");
    expect(f.description).toBe('Todo sobre "precios"');
    expect(f.h1Count).toBe(1);
    expect(f.canonical).toBe("https://acme.test/es/precios/");
    expect(f.htmlLang).toBe("es");
    expect(f.robots).toEqual(["noindex", "follow", "noarchive"]);
    expect(f.textLength).toBeGreaterThan(100);
  });

  it("distingue título ausente de título vacío, y toma solo el primero", () => {
    expect(parseHtml(page(""), URL0).title).toBeNull();
    expect(parseHtml(page("<title></title>"), URL0).title).toBe("");
    expect(parseHtml(page("<title>Uno</title><title>Dos</title>"), URL0).title).toBe("Uno");
  });

  it("tolera comentarios, atributos sin comillas, mayúsculas y etiquetas sin cerrar", () => {
    const f = parseHtml(`<HTML LANG=en><HEAD><!-- <title>falso</title> --><TITLE>Real</TITLE><META NAME=description CONTENT=hola><LINK REL=canonical HREF=https://acme.test/x><body><H1>uno<h1>dos<a href=/a>x<a href=/b>y`, URL0);
    expect(f.htmlLang).toBe("en");
    expect(f.title).toBe("Real");
    expect(f.description).toBe("hola");
    expect(f.canonical).toBe("https://acme.test/x");
    expect(f.h1Count).toBe(2);
    expect(f.links).toEqual(["https://acme.test/a", "https://acme.test/b"]);
  });

  it("un <title> sin cerrar se come lo que sigue, como en los navegadores", () => {
    const f = parseHtml("<html><head><title>Sin cerrar<meta name=description content=x></head><body><h1>Hola</h1></body></html>", URL0);
    expect(f.h1Count).toBe(0);
    expect(f.description).toBeNull();
  });

  it("un HTML cortado a mitad del título conserva lo leído", () => {
    expect(parseHtml("<html><head><title>Título cortado a la mit", URL0).title).toBe("Título cortado a la mit");
  });

  it("cuenta los h1 aunque estén anidados o con atributos", () => {
    expect(parseHtml(page("", `<h1 class="a">A</h1><section><h1>B</h1></section><h2>C</h2>`), URL0).h1Count).toBe(2);
  });

  it("canónica inválida o ausente es null", () => {
    expect(parseHtml(page('<link rel="canonical" href="">'), URL0).canonical).toBeNull();
    expect(parseHtml(page('<link rel="canonical" href="javascript:alert(1)">'), URL0).canonical).toBeNull();
    expect(parseHtml(page(""), URL0).canonical).toBeNull();
  });
});

describe("enlaces", () => {
  it("resuelve relativos, quita anclas y deduplica; ignora mailto, tel, javascript, anclas vacías y nofollow", () => {
    const f = parseHtml(
      page(
        "",
        `<a href="/a">1</a><a href="/a#x">2</a><a href="b">3</a><a href="../c">4</a><a href="https://otro.test/z">5</a><a href="mailto:a@b.c">6</a><a href="tel:1">7</a><a href="javascript:void(0)">8</a><a href="#top">9</a><a href="">10</a><a href="/n" rel="nofollow noopener">11</a><a>12</a>`,
      ),
      "https://acme.test/es/precios",
    );
    expect(f.links).toEqual(["https://acme.test/a", "https://acme.test/es/b", "https://acme.test/c", "https://otro.test/z"]);
  });

  it("respeta <base href>", () => {
    const f = parseHtml(page('<base href="https://acme.test/docs/">', '<a href="x">x</a>'), URL0);
    expect(f.links).toEqual(["https://acme.test/docs/x"]);
  });
});

describe("hreflang", () => {
  it("resuelve las direcciones y conserva el código tal cual", () => {
    const f = parseHtml(page('<link rel="alternate" hreflang="es" href="/es/"><link rel="alternate" hreflang="x-default" href="https://acme.test/"><link rel="alternate" type="application/rss+xml" href="/feed"><link rel="ALTERNATE" HREFLANG="en-US" href="/en/">'), URL0);
    expect(f.hreflang).toEqual([
      { lang: "es", href: "https://acme.test/es/" },
      { lang: "x-default", href: "https://acme.test/" },
      { lang: "en-US", href: "https://acme.test/en/" },
    ]);
  });
});

describe("datos estructurados", () => {
  const ld = (json: string) => `<script type="application/ld+json">${json}</script>`;

  it("lee los tipos y propiedades, también dentro de @graph, listas y tipos múltiples", () => {
    const f = parseHtml(
      page(
        ld(JSON.stringify({ "@context": "https://schema.org", "@graph": [{ "@type": "Organization", name: "Acme", url: "https://acme.test" }, { "@type": ["WebSite", "Thing"], name: "Acme" }] })) +
          ld(JSON.stringify([{ "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1 }] }])),
      ),
      URL0,
    );
    expect(f.jsonLd.invalid).toBe(0);
    expect(f.jsonLd.items).toContainEqual({ type: "Organization", props: ["name", "url"] });
    expect(f.jsonLd.items).toContainEqual({ type: "WebSite", props: ["name"] });
    expect(f.jsonLd.items).toContainEqual({ type: "Thing", props: ["name"] });
    expect(f.jsonLd.items).toContainEqual({ type: "BreadcrumbList", props: ["itemListElement"] });
    expect(f.jsonLd.items).toContainEqual({ type: "ListItem", props: ["position"] });
  });

  it("cuenta los bloques con JSON inválido y sigue con los demás", () => {
    const f = parseHtml(page(ld("{ no es json ") + ld(JSON.stringify({ "@type": "Organization", name: "A" })) + ld("")), URL0);
    expect(f.jsonLd.invalid).toBe(2);
    expect(f.jsonLd.items).toEqual([{ type: "Organization", props: ["name"] }]);
  });

  it("el texto del JSON-LD no cuenta como texto visible", () => {
    const f = parseHtml(page(ld(JSON.stringify({ "@type": "Thing", name: "x".repeat(500) })), ""), URL0);
    expect(f.textLength).toBe(0);
  });
});

describe("texto visible", () => {
  it("excluye scripts, estilos, noscript y plantillas", () => {
    const f = parseHtml(page("", "<script>var a = 'texto que no se ve';</script><style>.a{}</style><noscript>Activa JavaScript</noscript><template>no</template><p>Hola</p>"), URL0);
    expect(f.textLength).toBe(4);
  });

  it("un cascarón de aplicación de una sola página queda con casi nada de texto y sin h1", () => {
    const f = parseHtml(`<html><head><title>App</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>`, URL0);
    expect(f.textLength).toBe(0);
    expect(f.h1Count).toBe(0);
  });
});

describe("directrices de robots", () => {
  it("noindex y none piden no indexar; las demás no", () => {
    expect(hasNoindex(["noindex", "follow"])).toBe(true);
    expect(hasNoindex(["none"])).toBe(true);
    expect(hasNoindex(["nofollow", "noarchive"])).toBe(false);
    expect(hasNoindex([])).toBe(false);
  });

  it("X-Robots-Tag: sin agente, de Googlebot y de otros agentes", () => {
    expect(parseRobotsHeader(null)).toEqual([]);
    expect(parseRobotsHeader("noindex, nofollow")).toEqual(["noindex", "nofollow"]);
    expect(parseRobotsHeader("googlebot: noindex")).toEqual(["noindex"]);
    expect(parseRobotsHeader("otherbot: noindex")).toEqual([]);
    // Varias cabeceras unidas: la directriz con agente cambia el agente de las siguientes.
    expect(parseRobotsHeader("nofollow, otherbot: noindex, nosnippet")).toEqual(["nofollow"]);
    expect(parseRobotsHeader("otherbot: noindex, googlebot: noarchive, nosnippet")).toEqual(["noarchive", "nosnippet"]);
    expect(parseRobotsHeader("unavailable_after: 25 Jun 2030 15:00:00 PST")).toEqual(["unavailable_after: 25 jun 2030 15:00:00 pst"]);
  });
});
