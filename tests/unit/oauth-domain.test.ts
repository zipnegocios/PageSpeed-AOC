import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isAllowedRedirectUri, isCodeChallenge, sha256, verifyPkce } from "@/server/domain/oauth";
import { safeNext } from "@/lib/auth/safe-next";

const verifier = "a".repeat(43);
const challenge = createHash("sha256").update(verifier).digest("base64url");

describe("PKCE", () => {
  it("acepta el verificador que genera el desafío y rechaza cualquier otro", () => {
    expect(isCodeChallenge(challenge)).toBe(true);
    expect(verifyPkce(verifier, challenge)).toBe(true);
    expect(verifyPkce("b".repeat(43), challenge)).toBe(false);
    expect(verifyPkce("corto", challenge)).toBe(false);
    expect(verifyPkce(verifier, "x")).toBe(false);
    expect(verifyPkce(`${verifier}!`, challenge)).toBe(false);
  });
});

describe("direcciones de retorno", () => {
  it("permite claude.ai, claude.com y el bucle local; nada más", () => {
    for (const ok of [
      "https://claude.ai/api/mcp/auth_callback",
      "https://claude.com/api/mcp/auth_callback",
      "http://localhost:54321/callback",
      "http://127.0.0.1:8080/cb",
      "http://[::1]:9999/cb",
    ]) expect(isAllowedRedirectUri(ok), ok).toBe(true);
    for (const bad of [
      "https://evil.test/api/mcp/auth_callback",
      "https://claude.ai/otra/ruta",
      "https://claude.ai.evil.test/api/mcp/auth_callback",
      "http://claude.ai/api/mcp/auth_callback",
      "https://localhost:3000/cb",
      "http://localhost.evil.test/cb",
      "http://user:pass@localhost:1/cb",
      "http://localhost:1/cb#frag",
      "javascript:alert(1)",
      "no-es-url",
      "",
    ]) expect(isAllowedRedirectUri(bad), bad).toBe(false);
  });
});

describe("hash y destino tras iniciar sesión", () => {
  it("sha256 en hexadecimal", () => {
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("el `next` del login solo acepta rutas propias", () => {
    expect(safeNext("/oauth/authorize?client_id=1&state=x")).toBe("/oauth/authorize?client_id=1&state=x");
    for (const bad of [null, undefined, "", "https://evil.test", "//evil.test", "/\\evil.test", "evil", "/a\r\nb", "x".repeat(3000)]) expect(safeNext(bad as string), String(bad)).toBeNull();
  });
});
