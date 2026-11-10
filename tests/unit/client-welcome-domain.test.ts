import { describe, expect, it } from "vitest";
import {
  cleanServices,
  cleanTags,
  DEFAULT_SERVICES,
  SERVICE_KEYS,
  SOLUTION_SUGGESTIONS,
  TECH_SUGGESTIONS,
  unionServices,
  ccAddresses,
  CcParseError,
  endOfSupportNote,
  formatCcContacts,
  givenName,
  greetingNames,
  parseCcContacts,
  siteLabel,
} from "@/server/domain/client-welcome";

describe("personas en copia", () => {
  it("acepta «Nombre <correo>», «Nombre, correo» y solo el correo", () => {
    expect(parseCcContacts("Luis Vega <luis@x.com>\nMaría Soto, maria@x.com\nbeto@x.com")).toEqual([
      { name: "Luis Vega", email: "luis@x.com" },
      { name: "María Soto", email: "maria@x.com" },
      { name: "", email: "beto@x.com" },
    ]);
  });
  it("normaliza el correo y quita la línea idéntica repetida", () => {
    expect(parseCcContacts("Luis <LUIS@x.com>\nLuis <luis@x.com>")).toEqual([{ name: "Luis", email: "luis@x.com" }]);
  });
  it("dos personas pueden compartir una dirección: se conservan las dos con su nombre", () => {
    const list = parseCcContacts("Ana María Osorio <contact@x.com>\nDaniel Osorio <contact@x.com>");
    expect(list).toEqual([
      { name: "Ana María Osorio", email: "contact@x.com" },
      { name: "Daniel Osorio", email: "contact@x.com" },
    ]);
  });
  it("también comparten la del contacto principal, pero sin nombre no aportan nada", () => {
    expect(parseCcContacts("Ana María Osorio <contact@x.com>\ncontact@x.com\nluis@x.com", ["contact@x.com"])).toEqual([
      { name: "Ana María Osorio", email: "contact@x.com" },
      { name: "", email: "luis@x.com" },
    ]);
  });
  it("ignora líneas vacías y acepta saltos de línea de Windows", () => {
    expect(parseCcContacts("\r\nluis@x.com\r\n\r\n")).toHaveLength(1);
    expect(parseCcContacts("")).toEqual([]);
  });
  it("dice qué línea falla", () => {
    expect(() => parseCcContacts("Luis <luis@>")).toThrow(CcParseError);
    expect(() => parseCcContacts("Luis, sin correo")).toThrow(/No encuentro un correo válido/);
    expect(() => parseCcContacts("no es un correo")).toThrow(/no es válido/);
  });
  it("respeta el tope de diez personas", () => {
    const many = Array.from({ length: 11 }, (_, i) => `p${i}@x.com`).join("\n");
    expect(() => parseCcContacts(many)).toThrow(/Máximo 10/);
  });
  it("lo que se guarda vuelve a leerse igual", () => {
    const list = [
      { name: "Luis Vega", email: "luis@x.com" },
      { name: "", email: "beto@x.com" },
    ];
    expect(parseCcContacts(formatCcContacts(list))).toEqual(list);
  });
});

describe("direcciones en copia", () => {
  it("cada dirección una vez y sin la del contacto principal", () => {
    const list = [
      { name: "Ana María Osorio", email: "Contact@x.com" },
      { name: "Luis", email: "luis@x.com" },
      { name: "Otra", email: "luis@x.com" },
    ];
    expect(ccAddresses(list, "contact@x.com")).toEqual(["luis@x.com"]);
    expect(ccAddresses(list, null)).toEqual(["contact@x.com", "luis@x.com"]);
    expect(ccAddresses([], "a@x.com")).toEqual([]);
  });
});

describe("saludo y sitio", () => {
  it("usa el nombre de pila del contacto principal y de cada persona en copia, sin repetir", () => {
    expect(greetingNames("Ana Ríos", [{ name: "Luis Vega", email: "l@x.com" }, { name: "ana Soto", email: "a@x.com" }, { name: "", email: "z@x.com" }])).toEqual(["Ana", "Luis"]);
    expect(greetingNames(null, [])).toEqual([]);
  });
  it("el caso real: Daniel y Ana María Osorio con una misma dirección", () => {
    expect(greetingNames("Daniel Osorio", [{ name: "Ana María Osorio", email: "contact@x.com" }])).toEqual(["Daniel", "Ana María"]);
  });
  it("respeta los nombres compuestos frecuentes y no inventa otros", () => {
    expect(givenName("Ana María Osorio")).toBe("Ana María");
    expect(givenName("Ana María")).toBe("Ana María");
    expect(givenName("José Luis Pérez")).toBe("José Luis");
    expect(givenName("María José Soto")).toBe("María José");
    expect(givenName("Daniel Osorio")).toBe("Daniel");
    expect(givenName("Luis Vega")).toBe("Luis");
    expect(givenName("Ana Torres Díaz")).toBe("Ana");
    expect(givenName("Ana Ríos (dirección)")).toBe("Ana");
    expect(givenName("  ")).toBe("");
  });
  it("muestra el host sin www", () => {
    expect(siteLabel("https://www.cafeaurora.com")).toBe("cafeaurora.com");
    expect(siteLabel("https://tienda.cafeaurora.com:8443")).toBe("tienda.cafeaurora.com:8443");
    expect(siteLabel("no-es-url")).toBe("no-es-url");
  });
});

describe("nota de fin de soporte", () => {
  const before = new Date("2026-11-10T00:00:00Z");
  it("según las tecnologías del producto, sin importar mayúsculas ni acentos", () => {
    expect(endOfSupportNote(["WordPress"], before)).toContain("PHP 8.2");
    expect(endOfSupportNote(["  prestashop "], before)).toContain("PHP 8.2");
    expect(endOfSupportNote(["Next.js"], before)).toContain("Node.js 20");
    expect(endOfSupportNote("Laravel", before)).toContain("PHP 8.2");
  });
  it("basta con que una de las tecnologías la tenga", () => {
    expect(endOfSupportNote(["Flutter", "Firebase", "Laravel", "MySQL"], before)).toContain("PHP 8.2");
    expect(endOfSupportNote(["Swift (iOS)", "Next.js"], before)).toContain("Node.js 20");
  });
  it("sin nota para Shopify, para una app móvil ni para lo que no está en la lista", () => {
    expect(endOfSupportNote(["Shopify"], before)).toBeNull();
    expect(endOfSupportNote(["Swift (iOS)", "Firebase"], before)).toBeNull();
    expect(endOfSupportNote(["Sistema propio"], before)).toBeNull();
    expect(endOfSupportNote([], before)).toBeNull();
  });
  it("caduca: pasada su fecha ya no se cita", () => {
    expect(endOfSupportNote(["WordPress"], new Date("2026-12-31T23:00:00Z"))).not.toBeNull();
    expect(endOfSupportNote(["WordPress"], new Date("2027-01-01T00:00:00Z"))).toBeNull();
    expect(endOfSupportNote(["Next.js"], new Date("2027-05-01T00:00:00Z"))).toBeNull();
  });
});

describe("etiquetas libres", () => {
  it("recorta, quita vacías y repetidas sin distinguir mayúsculas ni acentos, y respeta el orden", () => {
    expect(cleanTags(["  Tienda  online ", "tienda online", "", "App móvil", "app movil"], "x").tags).toEqual(["Tienda online", "App móvil"]);
    expect(cleanTags("a, b ,, A", "x").tags).toEqual(["a", "b"]);
    expect(cleanTags(undefined, "x").tags).toEqual([]);
  });
  it("rechaza signos peligrosos, textos largos y demasiados elementos, diciendo qué campo", () => {
    expect(cleanTags(["<script>"], "Qué es").error).toContain("Qué es");
    expect(cleanTags(["a".repeat(61)], "Tecnología").error).toContain("60");
    expect(cleanTags(Array.from({ length: 13 }, (_, i) => `t${i}`), "Tecnología").error).toContain("12");
  });
});

describe("servicios del acompañamiento", () => {
  it("deja solo los conocidos, sin repetir y en el orden de siempre", () => {
    expect(cleanServices(["security", "web", "nada", "web", "deps"])).toEqual(["web", "deps", "security"]);
    expect(cleanServices("web")).toEqual([]);
    expect(SERVICE_KEYS).toEqual(["web", "seo", "server", "deps", "domain", "security"]);
    expect(DEFAULT_SERVICES).toEqual(["web", "seo", "security"]);
  });
  it("une lo que cubre cada producto", () => {
    expect([...unionServices([{ services: ["web", "seo"] }, { services: ["server", "nada"] }])].sort()).toEqual(["seo", "server", "web"]);
  });
});

describe("sugerencias", () => {
  it("cubren tipos de solución y tecnologías muy variados, sin repetirse", () => {
    const sol = SOLUTION_SUGGESTIONS.flatMap((g) => g.items);
    const tec = TECH_SUGGESTIONS.flatMap((g) => g.items);
    for (const x of ["tienda online (e-commerce)", "marketplace", "plataforma de e-learning", "CRM", "chatbot", "aplicación móvil iOS", "automatización de procesos"]) expect(sol).toContain(x);
    for (const x of ["WordPress", "Shopify", "Next.js", "Laravel", "Flutter", "Swift (iOS)", "PostgreSQL", "Docker", "n8n", "Moodle", "Stripe"]) expect(tec).toContain(x);
    expect(new Set(sol).size).toBe(sol.length);
    expect(new Set(tec).size).toBe(tec.length);
    expect(tec.length).toBeGreaterThan(80);
  });
});
