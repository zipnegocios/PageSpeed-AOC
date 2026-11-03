import { describe, expect, it } from "vitest";
import { AuthFailedError, AuditTimeoutError } from "@/server/domain/audit-errors";
import { classifyError } from "@/server/domain/error-classifier";
import { looksLikeLoginRedirect, parseCookieText, projectAuthSchema, summarize } from "@/server/domain/project-auth";
import { SecretBoxError, decryptJson, encryptJson, keyStatus, parseKey } from "@/server/crypto/secret-box";
import { randomBytes } from "node:crypto";

const KEY = randomBytes(32).toString("base64");
const OTHER = randomBytes(32).toString("base64");

describe("cifrado de credenciales", () => {
  it("cifra y descifra sin dejar nada legible, con un IV distinto cada vez", () => {
    const secret = { strategy: "form", username: "ana@acme.test", password: "contraseña-muy-secreta" };
    const a = encryptJson(secret, KEY);
    const b = encryptJson(secret, KEY);
    expect(a.equals(b)).toBe(false);
    expect(a.toString("latin1")).not.toContain("secreta");
    expect(a.toString("latin1")).not.toContain("ana@acme");
    expect(a[0]).toBe(1);
    expect(decryptJson(a, KEY)).toEqual(secret);
  });

  it("con otra clave o un dato manipulado falla sin detallar", () => {
    const enc = encryptJson({ a: 1 }, KEY);
    expect(() => decryptJson(enc, OTHER)).toThrowError(SecretBoxError);
    for (const i of [0, 5, 20, enc.length - 1]) {
      const bad = Buffer.from(enc);
      bad[i] = bad[i]! ^ 0xff;
      expect(() => decryptJson(bad, KEY), `byte ${i}`).toThrowError(SecretBoxError);
    }
    expect(() => decryptJson(Buffer.from("corto"), KEY)).toThrowError(/formato/);
  });

  it("valida la clave del entorno", () => {
    expect(keyStatus(KEY)).toBe("ok");
    expect(keyStatus(undefined)).toBe("missing");
    expect(keyStatus("")).toBe("missing");
    expect(keyStatus("abc")).toBe("invalid");
    expect(keyStatus(randomBytes(16).toString("base64"))).toBe("invalid");
    expect(parseKey(KEY)).toHaveLength(32);
    expect(() => encryptJson({}, undefined)).toThrowError(/AUTH_ENCRYPTION_KEY/);
  });
});

describe("cookies pegadas", () => {
  it("acepta líneas nombre=valor y la cabecera Cookie con ;", () => {
    expect(parseCookieText("sid=abc123\nlang=es")).toEqual([{ name: "sid", value: "abc123" }, { name: "lang", value: "es" }]);
    expect(parseCookieText("Cookie: sid=abc; theme=dark;  _ga=GA1.2.3")).toEqual([
      { name: "sid", value: "abc" }, { name: "theme", value: "dark" }, { name: "_ga", value: "GA1.2.3" },
    ]);
  });
  it("el valor puede llevar = (base64, JWT)", () => {
    expect(parseCookieText("token=eyJhbGciOi==.abc=")).toEqual([{ name: "token", value: "eyJhbGciOi==.abc=" }]);
  });
  it("rechaza texto sin formato, nombres inválidos y valores vacíos o con control", () => {
    for (const bad of ["", "   ", "sin-igual", "=valor", "mal nombre=1", "a=", "a=b\u0007c"]) {
      expect(() => parseCookieText(bad), JSON.stringify(bad)).toThrow();
    }
  });
  it("el mensaje de error no repite valores largos", () => {
    try {
      parseCookieText(`${"x".repeat(200)}`);
    } catch (e) {
      expect((e as Error).message.length).toBeLessThan(80);
    }
  });
});

describe("configuración de acceso", () => {
  it("valida cada estrategia y rechaza lo incompleto", () => {
    expect(projectAuthSchema.safeParse({ strategy: "cookie", cookies: [{ name: "a", value: "b" }] }).success).toBe(true);
    expect(projectAuthSchema.safeParse({ strategy: "cookie", cookies: [] }).success).toBe(false);
    expect(projectAuthSchema.safeParse({ strategy: "form", loginUrl: "https://x.test/login", username: "u", password: "p" }).success).toBe(true);
    expect(projectAuthSchema.safeParse({ strategy: "form", loginUrl: "https://x.test/login", username: "u", password: "" }).success).toBe(false);
    expect(projectAuthSchema.safeParse({ strategy: "otra" }).success).toBe(false);
  });
  it("el resumen nunca incluye contraseñas ni valores de cookies", () => {
    const form = summarize({ strategy: "form", loginUrl: "https://x.test/login", username: "ana", password: "SECRETA" });
    const cookie = summarize({ strategy: "cookie", cookies: [{ name: "sid", value: "VALOR-SECRETO" }] });
    expect(JSON.stringify(form)).not.toContain("SECRETA");
    expect(JSON.stringify(cookie)).not.toContain("SECRETO");
    expect(cookie).toMatchObject({ cookieNames: ["sid"] });
  });
});

describe("looksLikeLoginRedirect", () => {
  it.each([
    ["https://a.test/panel", "https://a.test/panel", undefined, false],
    ["https://a.test/panel", "https://a.test/login", undefined, true],
    ["https://a.test/panel", "https://a.test/users/sign_in", undefined, true],
    ["https://a.test/panel", "https://a.test/wp-login.php", undefined, true],
    ["https://a.test/panel", "https://a.test/panel/resumen", undefined, false],
    ["https://a.test/panel", "https://a.test/acceso", "https://a.test/acceso", true],
    ["https://a.test/login", "https://a.test/login", undefined, false], // pedir el login mismo no es una redirección
    ["https://a.test/panel", undefined, undefined, false],
    ["https://a.test/panel", "no-es-url", undefined, false],
  ] as const)("%s → %s", (requested, final, login, expected) => {
    expect(looksLikeLoginRedirect(requested, final, login)).toBe(expected);
  });
});

describe("clasificación de errores de acceso", () => {
  it("las credenciales inválidas no se reintentan", () => {
    expect(classifyError(new AuthFailedError("AUTH_FAILED", "No funcionó"))).toEqual({ code: "AUTH_FAILED", retryable: false, message: "No funcionó" });
    expect(classifyError(new AuthFailedError("AUTH_NOT_CONFIGURED", "x"))).toMatchObject({ code: "AUTH_NOT_CONFIGURED", retryable: false });
    const boxed = classifyError(new SecretBoxError("DECRYPT_FAILED", "detalle interno"));
    expect(boxed).toMatchObject({ code: "AUTH_CONFIG", retryable: false });
    expect(boxed.message).not.toContain("detalle interno");
    expect(classifyError(new AuditTimeoutError(1000)).retryable).toBe(true);
  });
});
