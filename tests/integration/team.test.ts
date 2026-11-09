import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFakeS3, type FakeS3 } from "../helpers/fake-s3";
import { createDb, type Database } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import * as s from "@/server/db/schema";
import { hashPassword } from "@/server/auth/password";
import type { MailMessage, Mailer } from "@/server/notify/mailer";
import { authenticate, resolveSession, seedAdminFromEnv, type AdminSummary } from "@/server/services/admin-auth";
import * as profile from "@/server/services/profile";
import * as team from "@/server/services/team";
import { createR2, type R2Store } from "@/server/storage/r2";

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
  let s3: FakeS3;
  let r2: R2Store;
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("foto-de-prueba")]);
  const deps = () => ({ mailer, appUrl: APP, now: () => clock, r2 });
  const tokenOf = (link: string) => link.slice(link.lastIndexOf("/") + 1);
  /** Invitar por correo (lo de siempre): devuelve el enlace. */
  const inviteEmail = async (actor: AdminSummary, raw: unknown, db: Database, d: ReturnType<typeof deps>) => {
    const r = await team.inviteMember(actor, raw, db, d);
    if (r.mode !== "email") throw new Error("se esperaba una invitación por correo");
    return r;
  };

  let owner: AdminSummary;
  beforeAll(async () => {
    await runMigrations(url!, "./drizzle");
    s3 = await startFakeS3();
    r2 = createR2({ endpoint: s3.url, region: "auto", bucket: "reportes", accessKeyId: "ak", secretAccessKey: "sk" });
  });
  afterAll(async () => {
    r2.destroy();
    await s3.close();
    await pool.end();
  });
  beforeEach(async () => {
    await db.execute(sql`truncate admin_users, admin_invites restart identity cascade`);
    s3.objects.clear();
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
    const r = await inviteEmail(owner, { email: "  Luis@Example.com " }, db, deps());
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
    const { link } = await inviteEmail(owner, { email: "luis@example.com" }, db, deps());
    const luis = await team.acceptInvite(tokenOf(link), { password: PASS, confirm: PASS }, db, deps());
    expect(luis).toMatchObject({ email: "luis@example.com", role: "admin" });
    expect((await authenticate("LUIS@example.com", PASS, db)).ok).toBe(true);
    expect(await resolveSession({ sub: luis.id, email: luis.email, pv: luis.pv }, db)).not.toBeNull();
    await expect(team.acceptInvite(tokenOf(link), { password: PASS, confirm: PASS }, db, deps())).rejects.toThrow(/no es válido o ya venció/);
    expect(await team.previewInvite(tokenOf(link), db, deps())).toBeNull();
  });

  it("valida la contraseña y no gasta el enlace si es corta o no coincide", async () => {
    const { link } = await inviteEmail(owner, { email: "luis@example.com" }, db, deps());
    await expect(team.acceptInvite(tokenOf(link), { password: "corta", confirm: "corta" }, db, deps())).rejects.toThrow(/al menos 12/);
    await expect(team.acceptInvite(tokenOf(link), { password: PASS, confirm: `${PASS}x` }, db, deps())).rejects.toThrow(/no coinciden/);
    expect(await team.previewInvite(tokenOf(link), db, deps())).not.toBeNull();
  });

  it("un enlace vencido, revocado, inventado o reemplazado no sirve, y todos dicen lo mismo", async () => {
    const a = await inviteEmail(owner, { email: "luis@example.com" }, db, deps());
    clock = new Date(T0.getTime() + 7 * DAY + 1);
    expect(await team.previewInvite(tokenOf(a.link), db, deps())).toBeNull();
    await expect(team.acceptInvite(tokenOf(a.link), { password: PASS, confirm: PASS }, db, deps())).rejects.toThrow(/no es válido o ya venció/);

    clock = T0;
    const b = await inviteEmail(owner, { email: "luis@example.com" }, db, deps());
    const c = await inviteEmail(owner, { email: "luis@example.com" }, db, deps()); // reemplaza a b
    await expect(team.acceptInvite(tokenOf(b.link), { password: PASS, confirm: PASS }, db, deps())).rejects.toThrow(/no es válido o ya venció/);
    const [pending] = (await team.listTeam(owner, db, deps())).invites;
    await team.revokeInvite(owner, pending!.id, db, deps());
    await expect(team.acceptInvite(tokenOf(c.link), { password: PASS, confirm: PASS }, db, deps())).rejects.toThrow(/no es válido o ya venció/);
    await expect(team.acceptInvite("x".repeat(43), { password: PASS, confirm: PASS }, db, deps())).rejects.toThrow(/no es válido o ya venció/);
    expect(await db.select().from(s.adminUsers)).toHaveLength(1);
  });

  it("no se invita a quien ya tiene cuenta ni con otras mayúsculas", async () => {
    await expect(inviteEmail(owner, { email: "GUSTAVO@example.com" }, db, deps())).rejects.toThrow(/ya tiene acceso/);
    await expect(inviteEmail(owner, { email: "no-es-correo" }, db, deps())).rejects.toThrow(/correo válido/);
    expect(sent).toHaveLength(0);
  });

  it("si el correo no sale, la invitación existe y el enlace se entrega igual", async () => {
    failMail = true;
    const r = await inviteEmail(owner, { email: "luis@example.com" }, db, deps());
    expect(r.emailed).toBe(false);
    expect(r.emailError).toContain("ECONNREFUSED");
    expect(await team.previewInvite(tokenOf(r.link), db, deps())).not.toBeNull();
  });

  it("solo el propietario gestiona el equipo", async () => {
    const { link } = await inviteEmail(owner, { email: "luis@example.com" }, db, deps());
    const luis = await team.acceptInvite(tokenOf(link), { password: PASS, confirm: PASS }, db, deps());
    await expect(team.listTeam(luis, db, deps())).rejects.toThrow();
    await expect(inviteEmail(luis, { email: "otra@example.com" }, db, deps())).rejects.toThrow();
    await expect(team.removeMember(luis, owner.id, db, deps())).rejects.toThrow();
    await expect(team.sendPasswordReset(luis, owner.id, db, deps())).rejects.toThrow();
  });

  it("quitar a alguien cierra su sesión y anula sus enlaces pendientes; no se puede quitar al propietario", async () => {
    const { link } = await inviteEmail(owner, { email: "luis@example.com" }, db, deps());
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
    const { link } = await inviteEmail(owner, { email: "luis@example.com" }, db, deps());
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
    const { link } = await inviteEmail(owner, { email: "luis@example.com" }, db, deps());
    await team.acceptInvite(tokenOf(link), { password: PASS, confirm: PASS }, db, deps());
    expect(await seedAdminFromEnv({ ADMIN_EMAIL: "x@example.com", ADMIN_PASSWORD: "contraseña-segura-9" }, db)).toBe("exists");
    await db.delete(s.adminUsers).where(eq(s.adminUsers.role, "owner"));
    expect(await seedAdminFromEnv({ ADMIN_EMAIL: "x@example.com", ADMIN_PASSWORD: "contraseña-segura-9" }, db)).toBe("created");
    const rows = await db.select().from(s.adminUsers);
    expect(rows.map((r) => `${r.email}:${r.role}`).sort()).toEqual(["luis@example.com:admin", "x@example.com:owner"]);
  });

  describe("perfil completo al invitar", () => {
    const avatars = () => [...s3.objects.keys()].filter((k) => k.startsWith("_avatars/"));

    it("por correo: la invitación lleva nombre y foto, y la cuenta nace con ellos al aceptarla", async () => {
      const r = await team.inviteMember(owner, { email: "luis@example.com", firstName: " Luis ", lastName: "Porteles", access: "email" }, db, deps(), png);
      expect(r).toMatchObject({ mode: "email", emailed: true });
      const [inv] = await db.select().from(s.adminInvites);
      expect(inv).toMatchObject({ firstName: "Luis", lastName: "Porteles" });
      expect(inv!.avatarKey!.startsWith(`_avatars/${inv!.userId}/`)).toBe(true);
      expect(s3.objects.has(inv!.avatarKey!)).toBe(true);
      expect((await team.listTeam(owner, db, deps())).invites[0]).toMatchObject({ firstName: "Luis", lastName: "Porteles" });

      const luis = await team.acceptInvite(tokenOf((r as { link: string }).link), { password: PASS, confirm: PASS }, db, deps());
      expect(luis).toMatchObject({ id: inv!.userId, email: "luis@example.com", firstName: "Luis", lastName: "Porteles", avatarKey: inv!.avatarKey, provisionalPassword: false });
      expect(await profile.readAvatar(luis.id, db, { r2 })).toMatchObject({ contentType: "image/png" });
    });

    it("con contraseña provisional: la cuenta se crea ya, sin correo, con su perfil, y la persona puede entrar y cambiarla", async () => {
      const PROV = "provisional-12345";
      const r = await team.inviteMember(owner, { email: "Luis@Example.com", firstName: "Luis", lastName: "Porteles", access: "password", password: PROV }, db, deps(), png);
      expect(r).toEqual({ mode: "password", to: "luis@example.com", password: PROV, loginUrl: `${APP}/login` });
      expect(sent).toHaveLength(0);
      const login = await authenticate("luis@example.com", PROV, db);
      if (!login.ok) throw new Error("debía entrar");
      expect(login.admin).toMatchObject({ role: "admin", firstName: "Luis", lastName: "Porteles", provisionalPassword: true });
      expect(avatars()).toHaveLength(1);
      expect(await profile.readAvatar(login.admin.id, db, { r2 })).not.toBeNull();
      expect((await team.listTeam(owner, db, deps())).members.find((m) => m.email === "luis@example.com")?.provisionalPassword).toBe(true);

      // Cambiarla en su perfil la deja de ser provisional y cierra la sesión anterior.
      const fresh = await profile.changePassword(login.admin, { current: PROV, password: "una-contraseña-propia-1", confirm: "una-contraseña-propia-1" }, db);
      expect(fresh.provisionalPassword).toBe(false);
      expect((await authenticate("luis@example.com", "una-contraseña-propia-1", db)).ok).toBe(true);
      expect((await team.listTeam(owner, db, deps())).members.find((m) => m.email === "luis@example.com")?.provisionalPassword).toBe(false);
    });

    it("valida antes de crear nada: contraseña corta, correo repetido y foto que no es imagen", async () => {
      const base = { email: "luis@example.com", access: "password" as const };
      await expect(team.inviteMember(owner, { ...base, password: "corta" }, db, deps(), png)).rejects.toThrow(/al menos 12/);
      await expect(team.inviteMember(owner, { ...base, password: "provisional-12345" }, db, deps(), Buffer.from("<svg onload=alert(1)>"))).rejects.toThrow(/PNG, JPEG o WebP/);
      await expect(team.inviteMember(owner, { ...base, email: "gustavo@example.com", password: "provisional-12345" }, db, deps(), png)).rejects.toThrow(/ya tiene acceso/);
      await expect(team.inviteMember(owner, { ...base, password: "provisional-12345", firstName: "x".repeat(61) }, db, deps(), png)).rejects.toThrow(/Hasta 60/);
      expect(await db.select().from(s.adminUsers)).toHaveLength(1);
      expect(avatars()).toHaveLength(0);
      expect(sent).toHaveLength(0);
    });

    it("las fotos pendientes se limpian: al revocar, al reemplazar la invitación y al quitar a la persona; reenviar conserva la foto", async () => {
      const a = await team.inviteMember(owner, { email: "luis@example.com", access: "email" }, db, deps(), png);
      expect(avatars()).toHaveLength(1);
      const [pending] = (await team.listTeam(owner, db, deps())).invites;
      const resent = await team.resendInvite(owner, pending!.id, db, deps());
      expect(avatars()).toHaveLength(1); // la misma foto
      expect(resent.link).not.toBe((a as { link: string }).link);
      const [row] = (await db.select().from(s.adminInvites)).filter((x) => x.revokedAt === null);
      expect(row!.avatarKey).not.toBeNull();

      // Una invitación nueva para el mismo correo, con otra foto, borra la anterior.
      await team.inviteMember(owner, { email: "luis@example.com", access: "email" }, db, deps(), png);
      expect(avatars()).toHaveLength(1);
      const [again] = (await team.listTeam(owner, db, deps())).invites;
      await team.revokeInvite(owner, again!.id, db, deps());
      expect(avatars()).toHaveLength(0);

      // Quitar a una persona borra su foto.
      await team.inviteMember(owner, { email: "ana@example.com", access: "password", password: "provisional-12345" }, db, deps(), png);
      const ana = (await team.listTeam(owner, db, deps())).members.find((m) => m.email === "ana@example.com")!;
      expect(avatars()).toHaveLength(1);
      await team.removeMember(owner, ana.id, db, deps());
      expect(avatars()).toHaveLength(0);
    });

    it("crear la cuenta con contraseña provisional anula la invitación pendiente de ese correo", async () => {
      const a = await team.inviteMember(owner, { email: "luis@example.com", access: "email" }, db, deps(), png);
      await team.inviteMember(owner, { email: "luis@example.com", access: "password", password: "provisional-12345" }, db, deps());
      expect(await team.previewInvite(tokenOf((a as { link: string }).link), db, deps())).toBeNull();
      expect(avatars()).toHaveLength(0); // la foto de la invitación anulada se borró
    });
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
