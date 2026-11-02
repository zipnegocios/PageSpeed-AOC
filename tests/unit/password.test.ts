import { describe, expect, it } from "vitest";
import { getDummyHash, hashPassword, verifyPassword } from "@/server/auth/password";

describe("contraseñas (scrypt)", () => {
  it("verifica la contraseña correcta y rechaza una incorrecta", async () => {
    const hash = await hashPassword("una-clave-larga-123");
    expect(await verifyPassword("una-clave-larga-123", hash)).toBe(true);
    expect(await verifyPassword("otra-clave-larga-1", hash)).toBe(false);
  });

  it("genera un hash distinto cada vez (sal aleatoria) y nunca guarda la clave en claro", async () => {
    const a = await hashPassword("misma-clave-12345");
    const b = await hashPassword("misma-clave-12345");
    expect(a).not.toBe(b);
    expect(a).not.toContain("misma-clave-12345");
    expect(a.startsWith("scrypt$16384$8$1$")).toBe(true);
  });

  it("rechaza hashes mal formados sin lanzar errores", async () => {
    for (const bad of ["", "texto", "scrypt$1$2", "bcrypt$1$1$1$a$b", "scrypt$x$8$1$AA==$AA==", "scrypt$16384$8$1$AA==$"]) {
      expect(await verifyPassword("lo-que-sea", bad)).toBe(false);
    }
  });

  it("el hash señuelo es válido pero no coincide con ninguna contraseña", async () => {
    const dummy = await getDummyHash();
    expect(dummy.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("password", dummy)).toBe(false);
  });
});
