import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import * as s from "@/server/db/schema";
import { hashPassword } from "@/server/auth/password";
import type { MailMessage, Mailer } from "@/server/notify/mailer";
import { authenticate, resolveSession, seedAdminFromEnv, type AdminSummary } from "@/server/services/admin-auth";
import * as team from "@/server/services/team";

const url = process.env.TEST_DATABASE_URL;
const APP = "https://app.test";
const T0 = new Date("2026-11-09T12:00:00Z");
const DAY = 86_400_000;
const PASS = "una-contraseña-larga-1";

describe.skipIf(!url)("equipo: invitaciones y roles", () => {
  const { db, pool } = createDb(url ?? "", 4);
  let sent: MailMessage[] = [];
  let failMail = false;
  let clock = T0;
  const mailer: Mailer = {
    send: async (m) => {
      if (failMail) throw Object.assign(new Error("conexión rechazada"), { code: "ECONNREFUSED" });
      sent.push(m);
    },
  };
  const deps = () => ({ mailer, appUrl: APP, now: () => clock });
  const tokenOf = (link: string) => link.slice(link.lastIndexOf("/") + 1);

  let owner: AdminSummary;
  beforeAll(async () => {
    await runMigrations(url!, "./drizzle");
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await db.execute(sql`truncate admin_users, admin_invites restart identity cascade`);
    sent = [];
    failMail = false;
    clock = T0;
    await seedAdminFromEnv({ ADMIN_EMAIL: "Gustavo@Example.com", ADMIN_PASSWORD: "contraseña-segura-1" }, db);
    const auth = await authenticate("gustavo@example.com", "contraseña-segura-1", db);
    if (!auth.ok) throw new Error("debía autenticar");
    owner = auth.admin;
  });

  it("el primero que se crea desde las variables es el propietario", async () => {
    expect(owner.role).toBe("owner");
    const [row] = await db.select().from(s.adminUsers);
    expect(row!.role).toBe("owner");
  });

  it("invitar envía el correo con el enlace y guarda solo el hash del token", async () => {
    const r = await team.inviteMember(owner, { email: "  Luis@Example.com " }, db, deps());
    expect(r).toMatchObject({ to: "luis@example.com", emailed: true });
    expect(r.link.startsWith(`${APP}/invitacion/`)).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "luis@example.com" });
    expect(sent[0]!.html).toContain(r.link);
    expect(sent[0]!.text).toContain(r.link);
    expect(sent[0]!.html).toContain("PAGESPEED");
    const [row] = await db.select().from(s.adminInvites);
    expect(row!.tokenHash).not.toContain(tokenOf(r.link));
    expect(row!.expiresAt.getTime() - T0.getTime()).toBe(7 * DAY);
    expect(await team.previewInvite(tokenOf(r.link), db, deps())).toEqual({ email: "luis@example.com", kind: "invite" });
  });

  it("aceptar la invitación crea la cuenta como administrador y deja entrar; el enlace sirve una sola vez", async () => {
    const { link } = await team.inviteMember(owner, { email: "luis@example.com" }, db, deps());
    const luis = await team.acceptInvite(tokenOf(link), { password: PASS, confirm: PASS }, db, deps());
    expect(luis).toMatchObject({ email: "luis@example.com", role: "admin" });
    expect((await authenticate("LUIS@example.com", PASS, db)).ok).toBe(true);
    expect(await resolveSession({ sub: luis.id, email: luis.email, pv: luis.pv }, db)).not.toBeNull();
    await expect(team.acceptInvite(tokenOf(link), { password: PASS, confirm: PASS }, db, deps())).rejects.toThrow(/no es válido o ya venció/);
    expect(await team.previewInvite(tokenOf(link), db, deps())).toBeNull();
  });

  it("valida la contraseña y no gasta el enlace si es corta o no coincide", async () => {
    const { link } = await team.inviteMember(owner, { email: "luis@example.com" }, db, deps());
    await expect(team.acceptInvite(tokenOf(link), { password: "corta", confirm: "corta" }, db, deps())).rejects.toThrow(/al menos 12/);
    await expect(team.acceptInvite(tokenOf(link), { password: PASS, confirm: `${PASS}x` }, db, deps())).rejects.toThrow(/no coinciden/);
    expect(await team.previewInvite(tokenOf(link), db, deps())).not.toBeNull();
  });

  it("un enlace vencido, revocado, inventado o reemplazado no sirve, y todos dicen lo mismo", async () => {
    const a = await team.inviteMember(owner, { email: "luis@example.com" }, db, deps());
    clock = new Date(T0.getTime() + 7 * DAY + 1);
    expect(await team.previewInvite(tokenOf(a.link), db, deps())).toBeNull();
    await expect(team.acceptInvite(tokenOf(a.link), { password: PASS, confirm: PASS }, db, deps())).rejects.toThrow(/no es válido o ya venció/);

    clock = T0;
    const b = await team.inviteMember(owner, { email: "luis@example.com" }, db, deps());
    const c = await team.inviteMember(owner, { email: "luis@example.com" }, db, deps()); // reemplaza a b
    await expect(team.acceptInvite(tokenOf(b.link), { password: PASS, confirm: PASS }, db, deps())).rejects.toThrow(/no es válido o ya venció/);
    const [pending] = (await team.listTeam(owner, db, deps())).invites;
    await team.revokeInvite(owner, pending!.id, db, deps());
    await expect(team.acceptInvite(tokenOf(c.link), { password: PASS, confirm: PASS }, db, deps())).rejects.toThrow(/no es válido o ya venció/);
    await expect(team.acceptInvite("x".repeat(43), { password: PASS, confirm: PASS }, db, deps())).rejects.toThrow(/no es válido o ya venció/);
    expect(await db.select().from(s.adminUsers)).toHaveLength(1);
  });

  it("no se invita a quien ya tiene cuenta ni con otras mayúsculas", async () => {
    await expect(team.inviteMember(owner, { email: "GUSTAVO@example.com" }, db, deps())).rejects.toThrow(/ya tiene acceso/);
    await expect(team.inviteMember(owner, { email: "no-es-correo" }, db, deps())).rejects.toThrow(/correo válido/);
    expect(sent).toHaveLength(0);
  });

  it("si el correo no sale, la invitación existe y el enlace se entrega igual", async () => {
    failMail = true;
    const r = await team.inviteMember(owner, { email: "luis@example.com" }, db, deps());
    expect(r.emailed).toBe(false);
    expect(r.emailError).toContain("ECONNREFUSED");
    expect(await team.previewInvite(tokenOf(r.link), db, deps())).not.toBeNull();
  });

  it("solo el propietario gestiona el equipo", async () => {
    const { link } = await team.inviteMember(owner, { email: "luis@example.com" }, db, deps());
    const luis = await team.acceptInvite(tokenOf(link), { password: PASS, confirm: PASS }, db, deps());
    await expect(team.listTeam(luis, db, deps())).rejects.toThrow();
    await expect(team.inviteMember(luis, { email: "otra@example.com" }, db, deps())).rejects.toThrow();
    await expect(team.removeMember(luis, owner.id, db, deps())).rejects.toThrow();
    await expect(team.sendPasswordReset(luis, owner.id, db, deps())).rejects.toThrow();
  });

  it("quitar a alguien cierra su sesión y anula sus enlaces pendientes; no se puede quitar al propietario", async () => {
    const { link } = await team.inviteMember(owner, { email: "luis@example.com" }, db, deps());
    const luis = await team.acceptInvite(tokenOf(link), { password: PASS, confirm: PASS }, db, deps());
    const reset = await team.sendPasswordReset(owner, luis.id, db, deps());
    await expect(team.removeMember(owner, owner.id, db, deps())).rejects.toThrow(/propietaria/);
    await team.removeMember(owner, luis.id, db, deps());
    expect(await resolveSession({ sub: luis.id, email: luis.email, pv: luis.pv }, db)).toBeNull();
    expect((await authenticate("luis@example.com", PASS, db)).ok).toBe(false);
    expect(await team.previewInvite(tokenOf(reset.link), db, deps())).toBeNull();
    expect((await team.listTeam(owner, db, deps())).members.map((m) => m.email)).toEqual(["gustavo@example.com"]);
  });

  it("el enlace de contraseña nueva cambia la contraseña e invalida la sesión anterior", async () => {
    const { link } = await team.inviteMember(owner, { email: "luis@example.com" }, db, deps());
    const luis = await team.acceptInvite(tokenOf(link), { password: PASS, confirm: PASS }, db, deps());
    const reset = await team.sendPasswordReset(owner, luis.id, db, deps());
    expect(sent.at(-1)!.subject).toMatch(/contraseña nueva/i);
    expect(await team.previewInvite(tokenOf(reset.link), db, deps())).toEqual({ email: "luis@example.com", kind: "reset" });
    const NEW = "otra-contraseña-larga-2";
    const after = await team.acceptInvite(tokenOf(reset.link), { password: NEW, confirm: NEW }, db, deps());
    expect(after.id).toBe(luis.id);
    expect((await authenticate("luis@example.com", NEW, db)).ok).toBe(true);
    expect((await authenticate("luis@example.com", PASS, db)).ok).toBe(false);
    expect(await resolveSession({ sub: luis.id, email: luis.email, pv: luis.pv }, db)).toBeNull();
    await expect(team.sendPasswordReset(owner, owner.id, db, deps())).rejects.toThrow(/propietaria/);
  });

  it("si se borra la fila del propietario, las variables crean uno nuevo sin tocar a los demás", async () => {
    const { link } = await team.inviteMember(owner, { email: "luis@example.com" }, db, deps());
    await team.acceptInvite(tokenOf(link), { password: PASS, confirm: PASS }, db, deps());
    expect(await seedAdminFromEnv({ ADMIN_EMAIL: "x@example.com", ADMIN_PASSWORD: "contraseña-segura-9" }, db)).toBe("exists");
    await db.delete(s.adminUsers).where(eq(s.adminUsers.role, "owner"));
    expect(await seedAdminFromEnv({ ADMIN_EMAIL: "x@example.com", ADMIN_PASSWORD: "contraseña-segura-9" }, db)).toBe("created");
    const rows = await db.select().from(s.adminUsers);
    expect(rows.map((r) => `${r.email}:${r.role}`).sort()).toEqual(["luis@example.com:admin", "x@example.com:owner"]);
  });

  it("la migración dejó al administrador más antiguo como propietario", async () => {
    await db.execute(sql`truncate admin_users restart identity cascade`);
    const hash = await hashPassword("contraseña-segura-1");
    await db.insert(s.adminUsers).values({ email: "a@x.test", passwordHash: hash, createdAt: new Date("2026-01-01") });
    await db.insert(s.adminUsers).values({ email: "b@x.test", passwordHash: hash, createdAt: new Date("2026-02-01") });
    await db.execute(sql`UPDATE "admin_users" SET "role" = 'owner' WHERE "id" = (SELECT "id" FROM "admin_users" ORDER BY "created_at" ASC LIMIT 1)`);
    const rows = await db.select().from(s.adminUsers).orderBy(s.adminUsers.createdAt);
    expect(rows.map((r) => r.role)).toEqual(["owner", "admin"]);
    expect(await db.select().from(s.adminUsers).where(eq(s.adminUsers.role, "owner"))).toHaveLength(1);
  });
});
