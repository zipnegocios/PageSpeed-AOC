import { describe, expect, it } from "vitest";
import {
  CcParseError,
  endOfSupportNote,
  formatCcContacts,
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
  it("normaliza el correo y quita repetidos y al contacto principal", () => {
    expect(parseCcContacts("A <LUIS@x.com>\nOtro <luis@x.com>\nAna <ana@x.com>", ["ANA@x.com"])).toEqual([{ name: "A", email: "luis@x.com" }]);
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

describe("saludo y sitio", () => {
  it("usa el nombre de pila del contacto principal y de cada persona en copia, sin repetir", () => {
    expect(greetingNames("Ana Ríos", [{ name: "Luis Vega", email: "l@x.com" }, { name: "ana Soto", email: "a@x.com" }, { name: "", email: "z@x.com" }])).toEqual(["Ana", "Luis"]);
    expect(greetingNames(null, [])).toEqual([]);
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
