import { describe, expect, it } from "vitest";
import {
  passwordVersion,
  readSessionToken,
  SESSION_TTL_SECONDS,
  signSessionToken,
} from "@/server/auth/session-token";

const secret = "s".repeat(40);
const claims = { sub: "11111111-1111-1111-1111-111111111111", email: "admin@example.com", pv: "abc123" };

describe("token de sesión", () => {
  it("firma y lee los datos de la sesión", async () => {
    const { token, expiresAt } = await signSessionToken(claims, secret);
    expect(await readSessionToken(token, secret)).toEqual(claims);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("vence a los 7 días", async () => {
    const issued = new Date("2026-01-01T00:00:00Z");
    const { token } = await signSessionToken(claims, secret, issued);
    const justBefore = new Date(issued.getTime() + (SESSION_TTL_SECONDS - 5) * 1000);
    const justAfter = new Date(issued.getTime() + (SESSION_TTL_SECONDS + 5) * 1000);
    expect(await readSessionToken(token, secret, justBefore)).not.toBeNull();
    expect(await readSessionToken(token, secret, justAfter)).toBeNull();
  });

  it("rechaza un token firmado con otro secreto, alterado o basura", async () => {
    const { token } = await signSessionToken(claims, secret);
    expect(await readSessionToken(token, "t".repeat(40))).toBeNull();
    const [h, p, sig] = token.split(".");
    const tampered = `${h}.${Buffer.from(JSON.stringify({ sub: "otro" })).toString("base64url")}.${sig}`;
    expect(await readSessionToken(tampered, secret)).toBeNull();
    expect(await readSessionToken(`${h}.${p}.`, secret)).toBeNull();
    expect(await readSessionToken("no-es-un-token", secret)).toBeNull();
    expect(await readSessionToken("", secret)).toBeNull();
  });

  it("se niega a firmar con un secreto corto", async () => {
    await expect(signSessionToken(claims, "corto")).rejects.toThrow(/32/);
  });

  it("la versión de contraseña cambia cuando cambia el hash", () => {
    expect(passwordVersion("hash-a")).toBe(passwordVersion("hash-a"));
    expect(passwordVersion("hash-a")).not.toBe(passwordVersion("hash-b"));
    expect(passwordVersion("hash-a")).toHaveLength(16);
  });
});
