import { describe, expect, it } from "vitest";
import { INVITE_TTL_MS, assertCanRemove, assertOwner, isInviteUsable } from "@/server/domain/team";

const now = new Date("2026-11-09T12:00:00Z");
const valid = { expiresAt: new Date(now.getTime() + 1000), acceptedAt: null, revokedAt: null };

describe("reglas del equipo", () => {
  it("una invitación sirve mientras no se use, no se revoque y no venza", () => {
    expect(isInviteUsable(valid, now)).toBe(true);
    expect(isInviteUsable({ ...valid, expiresAt: now }, now)).toBe(false);
    expect(isInviteUsable({ ...valid, acceptedAt: now }, now)).toBe(false);
    expect(isInviteUsable({ ...valid, revokedAt: now }, now)).toBe(false);
    expect(INVITE_TTL_MS).toBe(7 * 24 * 3600 * 1000);
  });

  it("solo el propietario gestiona el equipo", () => {
    expect(() => assertOwner({ role: "owner" })).not.toThrow();
    expect(() => assertOwner({ role: "admin" })).toThrow(/no encontrada/);
  });

  it("no se quita al propietario ni a uno mismo, y siempre queda alguien", () => {
    const actor = { id: "a" };
    expect(() => assertCanRemove(actor, { id: "b", role: "admin" }, 2)).not.toThrow();
    expect(() => assertCanRemove(actor, { id: "o", role: "owner" }, 3)).toThrow(/propietaria/);
    expect(() => assertCanRemove(actor, { id: "a", role: "admin" }, 3)).toThrow(/a ti mismo/);
    expect(() => assertCanRemove(actor, { id: "b", role: "admin" }, 1)).toThrow(/al menos un administrador/);
  });
});
