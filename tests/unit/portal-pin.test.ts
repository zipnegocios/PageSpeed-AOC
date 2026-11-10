import { describe, expect, it } from "vitest";
import { generatePin, hashPin, isPin, pinMatches } from "@/server/domain/portal-pin";
import { DEFAULT_SENDER } from "@/server/domain/client-sender";
import { buildPinEmail } from "@/server/notify/pin-email";
import { readPortalSession, signPortalSession } from "@/server/auth/portal-session";

const SECRET = "k".repeat(40);
const ID = "11111111-1111-4111-8111-111111111111";

describe("PIN del portal", () => {
  it("genera siempre 6 dígitos, con ceros a la izquierda, y no repite siempre el mismo", () => {
    const pins = Array.from({ length: 300 }, generatePin);
    expect(pins.every((p) => /^\d{6}$/.test(p))).toBe(true);
    expect(new Set(pins).size).toBeGreaterThan(250);
  });

  it("isPin solo acepta exactamente 6 dígitos", () => {
    for (const ok of ["000000", "123456", "999999"]) expect(isPin(ok)).toBe(true);
    for (const bad of ["12345", "1234567", "12345a", "12 456", "", "١٢٣٤٥٦", "123456\n"]) expect(isPin(bad)).toBe(false);
  });

  it("la huella depende del PIN, del cliente y de la clave del servidor", () => {
    const h = hashPin(ID, "123456", SECRET);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPin(ID, "123457", SECRET)).not.toBe(h);
    expect(hashPin("22222222-2222-4222-8222-222222222222", "123456", SECRET)).not.toBe(h);
    expect(hashPin(ID, "123456", "z".repeat(40))).not.toBe(h);
    expect(h).not.toContain("123456");
  });

  it("pinMatches acepta el PIN correcto y rechaza el resto, también sin PIN guardado", () => {
    const h = hashPin(ID, "123456", SECRET);
    expect(pinMatches(h, ID, "123456", SECRET)).toBe(true);
    expect(pinMatches(h, ID, "654321", SECRET)).toBe(false);
    expect(pinMatches(null, ID, "123456", SECRET)).toBe(false);
    expect(pinMatches("", ID, "123456", SECRET)).toBe(false);
    expect(pinMatches("zz", ID, "123456", SECRET)).toBe(false);
  });

  it("el correo lleva el PIN, el enlace y escapa lo que viene del cliente", () => {
    const m = buildPinEmail({ contactName: "Ana", clientName: "Acme & Co <i>", pin: "004217", portalUrl: "https://app.test/c/acme", sender: DEFAULT_SENDER, appUrl: "https://app.test" });
    expect(m.subject).toBe("Tu PIN para ver tu informe");
    expect(m.text).toContain("PIN: 004217");
    expect(m.text).toContain("https://app.test/c/acme");
    expect(m.html).toContain("004217");
    expect(m.html).not.toContain("<i>");
    expect(m.html).toContain("Acme &amp; Co &lt;i&gt;");
  });
});

describe("sesión del portal", () => {
  it("firma y lee; un secreto distinto, un token roto o uno de otro tipo no valen", async () => {
    const { token } = await signPortalSession({ sub: ID, pv: 3 }, SECRET);
    expect(await readPortalSession(token, SECRET)).toEqual({ sub: ID, pv: 3 });
    expect(await readPortalSession(token, "x".repeat(40))).toBeNull();
    expect(await readPortalSession(token + "a", SECRET)).toBeNull();
    expect(await readPortalSession("", SECRET)).toBeNull();
  });
  it("vence a los 30 días", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const { token, expiresAt } = await signPortalSession({ sub: ID, pv: 1 }, SECRET, now);
    expect(expiresAt.getTime() - now.getTime()).toBe(30 * 86_400_000);
    expect(await readPortalSession(token, SECRET, new Date(now.getTime() + 29 * 86_400_000))).not.toBeNull();
    expect(await readPortalSession(token, SECRET, new Date(now.getTime() + 31 * 86_400_000))).toBeNull();
  });
});
