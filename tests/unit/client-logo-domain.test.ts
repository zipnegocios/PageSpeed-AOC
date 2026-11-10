import { describe, expect, it } from "vitest";
import { signPwaIcon, verifyPwaIcon } from "@/server/auth/pwa-icon-sig";
import { LOGO_MAX_BYTES, assertLogo, clientInitials, isLogoKind, logoInfo, parseLogoBg, pngSize } from "@/server/domain/client-logo";

/** Un PNG mínimo con la cabecera IHDR de las medidas dadas (no hace falta que se pueda decodificar: se valida la cabecera). */
function png(width: number, height: number, extra = 0): Uint8Array {
  const b = new Uint8Array(33 + extra);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const dv = new DataView(b.buffer);
  dv.setUint32(16, width);
  dv.setUint32(20, height);
  return b;
}

describe("logotipo de cliente: validación", () => {
  it("lee las medidas de la cabecera del PNG y rechaza lo que no lo es", () => {
    expect(pngSize(png(300, 120))).toEqual({ width: 300, height: 120 });
    expect(pngSize(new TextEncoder().encode("<svg onload=alert(1)></svg>................"))).toBeNull();
    expect(pngSize(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull(); // JPEG
    const noIhdr = png(10, 10);
    noIhdr[12] = 0x58;
    expect(pngSize(noIhdr)).toBeNull();
  });

  it("el isotipo debe ser casi cuadrado y el logotipo completo admite proporciones alargadas", () => {
    expect(assertLogo(png(512, 512), "icon")).toEqual({ width: 512, height: 512 });
    expect(assertLogo(png(512, 256), "icon")).toBeTruthy(); // el doble de ancho: el límite
    expect(() => assertLogo(png(600, 200), "icon")).toThrow(/casi cuadrado/);
    expect(assertLogo(png(1024, 200), "full")).toBeTruthy();
    expect(assertLogo(png(300, 900), "full")).toBeTruthy(); // vertical
    expect(() => assertLogo(png(1024, 100), "full")).toThrow(/alargado/);
  });

  it("rechaza vacío, peso excesivo, medidas fuera de rango y cualquier cosa que no sea PNG", () => {
    expect(() => assertLogo(new Uint8Array(), "icon")).toThrow(/Elige una imagen/);
    expect(() => assertLogo(png(100, 100, LOGO_MAX_BYTES), "icon")).toThrow(/pesa demasiado/);
    expect(() => assertLogo(png(8, 8), "icon")).toThrow(/demasiado pequeña/);
    expect(() => assertLogo(png(2000, 2000), "icon")).toThrow(/demasiado grande/);
    expect(() => assertLogo(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>"), "full")).toThrow(/PNG/);
  });

  it("el color de fondo es #RRGGBB (con o sin #) y vacío lo quita", () => {
    expect(parseLogoBg("#1f2937")).toBe("#1F2937");
    expect(parseLogoBg("1F2937")).toBe("#1F2937");
    expect(parseLogoBg("  ")).toBeNull();
    expect(parseLogoBg(undefined)).toBeNull();
    expect(() => parseLogoBg("rojo")).toThrow(/#RRGGBB/);
    expect(() => parseLogoBg("#fff")).toThrow(/#RRGGBB/);
    expect(() => parseLogoBg("#1F2937; background:url(x)")).toThrow(/#RRGGBB/);
  });

  it("logoInfo solo existe si hay algún logotipo y lleva una versión que cambia", () => {
    const base = { logoIconKey: null, logoFullKey: null, logoBg: null, logoUpdatedAt: null };
    expect(logoInfo(base)).toBeNull();
    const at = new Date("2026-11-10T12:00:00Z");
    expect(logoInfo({ ...base, logoFullKey: "_logos/x/full-1.png", logoUpdatedAt: at })).toEqual({ icon: false, full: true, bg: null, v: at.getTime() });
    expect(logoInfo({ ...base, logoIconKey: "k", logoBg: "#111827", logoUpdatedAt: at })).toMatchObject({ icon: true, full: false, bg: "#111827" });
  });

  it("los tipos válidos son icon y full; las iniciales, hasta dos letras", () => {
    expect(isLogoKind("icon") && isLogoKind("full")).toBe(true);
    expect(isLogoKind("../etc") || isLogoKind(undefined)).toBe(false);
    expect(clientInitials("Tecnostar Ingeniería")).toBe("TI");
    expect(clientInitials("3coren")).toBe("3");
    expect(clientInitials("álvaro ñandú sa")).toBe("ÁÑ");
  });
});

describe("icono de la app: firma de la dirección", () => {
  const secret = "s".repeat(40);
  it("solo vale la firma emitida para ese enlace y esa versión", () => {
    const s = signPwaIcon(secret, "tecnostar", "123");
    expect(verifyPwaIcon(secret, "tecnostar", "123", s)).toBe(true);
    expect(verifyPwaIcon(secret, "otro-cliente", "123", s)).toBe(false);
    expect(verifyPwaIcon(secret, "tecnostar", "124", s)).toBe(false);
    expect(verifyPwaIcon("t".repeat(40), "tecnostar", "123", s)).toBe(false);
    expect(verifyPwaIcon(secret, "tecnostar", "123", "")).toBe(false);
    expect(verifyPwaIcon(secret, "tecnostar", "123", `${s}x`)).toBe(false);
  });
});
