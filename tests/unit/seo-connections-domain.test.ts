import { describe, expect, it } from "vitest";
import { isDomainError } from "@/server/domain/errors";
import {
  explainFailure,
  gscPermissionText,
  normalizeCloudflareToken,
  normalizeCloudflareZone,
  normalizeExternalId,
  normalizeGa4Property,
  normalizeGscProperty,
  parseKind,
} from "@/server/domain/seo-connections";

const invalid = (fn: () => unknown, text: RegExp) => {
  try {
    fn();
  } catch (err) {
    expect(isDomainError(err)).toBe(true);
    expect((err as Error).message).toMatch(text);
    return;
  }
  throw new Error("no lanzó");
};

describe("propiedad de Search Console", () => {
  it("acepta dominio, prefijo de URL y dominio suelto", () => {
    expect(normalizeGscProperty("sc-domain:Ejemplo.com")).toBe("sc-domain:ejemplo.com");
    expect(normalizeGscProperty("  SC-DOMAIN:ejemplo.com  ")).toBe("sc-domain:ejemplo.com");
    expect(normalizeGscProperty("https://www.ejemplo.com")).toBe("https://www.ejemplo.com/");
    expect(normalizeGscProperty("https://ejemplo.com/es?x=1#a")).toBe("https://ejemplo.com/es/");
    expect(normalizeGscProperty("Ejemplo.com")).toBe("sc-domain:ejemplo.com");
    expect(normalizeGscProperty("sub.ejemplo.co.ve")).toBe("sc-domain:sub.ejemplo.co.ve");
  });

  it("rechaza lo que no es una propiedad", () => {
    invalid(() => normalizeGscProperty(""), /Indica la propiedad/);
    invalid(() => normalizeGscProperty("sc-domain:no es dominio"), /dominio de la propiedad/);
    invalid(() => normalizeGscProperty("hola"), /No reconozco/);
    invalid(() => normalizeGscProperty("https://"), /no es válida/);
  });
});

describe("propiedad de GA4", () => {
  it("acepta el ID numérico, con o sin properties/", () => {
    expect(normalizeGa4Property("123456789")).toBe("123456789");
    expect(normalizeGa4Property(" properties/123456789 ")).toBe("123456789");
  });

  it("explica la confusión con el ID de medición", () => {
    invalid(() => normalizeGa4Property("G-ABC123XYZ"), /ID de medición/);
    invalid(() => normalizeGa4Property("UA-1234-1"), /ID de medición/);
    invalid(() => normalizeGa4Property("abc"), /es un número/);
    invalid(() => normalizeGa4Property("12"), /es un número/);
  });
});

describe("Cloudflare", () => {
  it("valida la zona y el token", () => {
    expect(normalizeCloudflareZone(`  ${"A".repeat(32)} `)).toBe("a".repeat(32));
    invalid(() => normalizeCloudflareZone("corto"), /32 caracteres/);
    invalid(() => normalizeCloudflareZone("z".repeat(32)), /32 caracteres/);
    expect(normalizeCloudflareToken(" abcdefghijklmnopqrstuvwxyz ")).toBe("abcdefghijklmnopqrstuvwxyz");
    invalid(() => normalizeCloudflareToken("corto"), /no parece válido/);
    invalid(() => normalizeCloudflareToken("con espacios dentro del token largo"), /no parece válido/);
  });
});

describe("tipos y mensajes", () => {
  it("reconoce los tipos de conexión", () => {
    expect(parseKind("gsc")).toBe("gsc");
    invalid(() => parseKind("otro"), /desconocido/);
    expect(normalizeExternalId("ga4", "123456")).toBe("123456");
  });

  it("traduce los permisos de Search Console", () => {
    expect(gscPermissionText("siteOwner")).toBe("propietario");
    expect(gscPermissionText("siteRestrictedUser")).toBe("usuario restringido");
    expect(gscPermissionText("raro")).toBe("raro");
  });

  it("dice qué hacer ante cada fallo, nombrando la cuenta de servicio", () => {
    const email = "spike@demo.iam.gserviceaccount.com";
    expect(explainFailure("ga4", "FORBIDDEN", { email })).toContain(email);
    expect(explainFailure("ga4", "FORBIDDEN", { email })).toMatch(/rol Lector/);
    expect(explainFailure("ga4", "NOT_FOUND")).toMatch(/ID numérico/);
    expect(explainFailure("gsc", "FORBIDDEN", { email })).toMatch(/Search Console API/);
    expect(explainFailure("cloudflare", "AUTH")).toMatch(/token debe estar activo/);
    expect(explainFailure("gsc", "QUOTA")).toMatch(/esperar/);
    expect(explainFailure("cloudflare", "UNAVAILABLE")).toMatch(/No se pudo contactar/);
  });
});
