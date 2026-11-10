import { describe, expect, it } from "vitest";
import {
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
  it("según la tecnología, sin importar mayúsculas ni acentos", () => {
    expect(endOfSupportNote("WordPress", before)).toContain("PHP 8.2");
    expect(endOfSupportNote("  prestashop ", before)).toContain("PHP 8.2");
    expect(endOfSupportNote("Next.js", before)).toContain("Node.js 20");
  });
  it("sin nota para Shopify ni para lo que no está en la lista", () => {
    expect(endOfSupportNote("Shopify", before)).toBeNull();
    expect(endOfSupportNote("Sistema propio", before)).toBeNull();
  });
  it("caduca: pasada su fecha ya no se cita", () => {
    expect(endOfSupportNote("WordPress", new Date("2026-12-31T23:00:00Z"))).not.toBeNull();
    expect(endOfSupportNote("WordPress", new Date("2027-01-01T00:00:00Z"))).toBeNull();
    expect(endOfSupportNote("Next.js", new Date("2027-05-01T00:00:00Z"))).toBeNull();
  });
});
