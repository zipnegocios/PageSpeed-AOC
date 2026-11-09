import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startFakeS3, type FakeS3 } from "../helpers/fake-s3";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { authenticate, resolveSession, seedAdminFromEnv, type AdminSummary } from "@/server/services/admin-auth";
import * as profile from "@/server/services/profile";
import { createR2, type R2Store } from "@/server/storage/r2";

const url = process.env.TEST_DATABASE_URL;
const PASS = "contraseña-segura-1";
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("datos-de-prueba")]);
const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([1, 2, 3, 4]), Buffer.from("WEBP"), Buffer.from("datos")]);

// La ruta del avatar pide la sesión a Next; fuera de una petición se simula.
const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => session.current }));

describe.skipIf(!url)("perfil: nombre, contraseña y foto", () => {
  const { db, pool } = createDb(url ?? "", 4);
  let s3: FakeS3;
  let r2: R2Store;
  let admin: AdminSummary;

  beforeAll(async () => {
    await runMigrations(url!, "./drizzle");
    s3 = await startFakeS3();
    r2 = createR2({ endpoint: s3.url, region: "auto", bucket: "reportes", accessKeyId: "ak", secretAccessKey: "sk" });
    Object.assign(process.env, {
      DATABASE_URL: url, SESSION_SECRET: "x".repeat(40), R2_ENDPOINT: s3.url, R2_BUCKET: "reportes", R2_ACCESS_KEY_ID: "ak", R2_SECRET_ACCESS_KEY: "sk",
      REDIS_URL: process.env.TEST_REDIS_URL ?? "redis://localhost:6379", SMTP_HOST: "localhost", EMAIL_FROM: "x@x.test",
    });
  });
  afterAll(async () => {
    r2.destroy();
    await s3.close();
    await pool.end();
  });
  beforeEach(async () => {
    await db.execute(sql`truncate admin_users, admin_invites restart identity cascade`);
    s3.objects.clear();
    await seedAdminFromEnv({ ADMIN_EMAIL: "gustavo@example.com", ADMIN_PASSWORD: PASS }, db);
    const r = await authenticate("gustavo@example.com", PASS, db);
    if (!r.ok) throw new Error("debía autenticar");
    admin = r.admin;
    session.current = admin;
  });

  it("guarda nombre y apellido (opcionales, recortados) y los devuelve en el resumen", async () => {
    const out = await profile.updateProfile(admin, { firstName: "  Gustavo ", lastName: "Amarista" }, db);
    expect(out).toMatchObject({ firstName: "Gustavo", lastName: "Amarista" });
    expect((await authenticate("gustavo@example.com", PASS, db)).ok && (await resolveSession({ sub: admin.id, email: admin.email, pv: admin.pv }, db))).toMatchObject({ firstName: "Gustavo" });
    expect(await profile.updateProfile(admin, { firstName: " ", lastName: "" }, db)).toMatchObject({ firstName: null, lastName: null });
    await expect(profile.updateProfile(admin, { firstName: "x".repeat(61), lastName: "" }, db)).rejects.toThrow(/Hasta 60/);
    await expect(profile.updateProfile(admin, { firstName: "a\nb", lastName: "" }, db)).rejects.toThrow(/saltos de línea/);
  });

  it("cambiar la contraseña pide la actual, valida la nueva, cierra las demás sesiones y deja entrar con la nueva", async () => {
    const NEW = "otra-contraseña-larga-2";
    await expect(profile.changePassword(admin, { current: "incorrecta-123456", password: NEW, confirm: NEW }, db)).rejects.toThrow(/actual no es correcta/);
    await expect(profile.changePassword(admin, { current: PASS, password: "corta", confirm: "corta" }, db)).rejects.toThrow(/al menos 12/);
    await expect(profile.changePassword(admin, { current: PASS, password: NEW, confirm: `${NEW}x` }, db)).rejects.toThrow(/no coinciden/);
    await expect(profile.changePassword(admin, { current: PASS, password: PASS, confirm: PASS }, db)).rejects.toThrow(/distinta de la actual/);
    expect((await authenticate("gustavo@example.com", PASS, db)).ok).toBe(true); // nada cambió

    const fresh = await profile.changePassword(admin, { current: PASS, password: NEW, confirm: NEW }, db);
    expect((await authenticate("gustavo@example.com", NEW, db)).ok).toBe(true);
    expect((await authenticate("gustavo@example.com", PASS, db)).ok).toBe(false);
    // Otra sesión abierta con la versión anterior deja de valer; la renovada con el resumen nuevo, sí.
    expect(await resolveSession({ sub: admin.id, email: admin.email, pv: admin.pv }, db)).toBeNull();
    expect(await resolveSession({ sub: fresh.id, email: fresh.email, pv: fresh.pv }, db)).not.toBeNull();
  });

  it("frena los intentos con la contraseña actual incorrecta", async () => {
    const NEW = "otra-contraseña-larga-2";
    for (let i = 0; i < 5; i++) await expect(profile.changePassword(admin, { current: "mala-contraseña-1", password: NEW, confirm: NEW }, db)).rejects.toThrow(/actual no es correcta/);
    await expect(profile.changePassword(admin, { current: PASS, password: NEW, confirm: NEW }, db)).rejects.toThrow(/Demasiados intentos/);
  });

  it("la foto se guarda en R2 bajo _avatars/, reemplazarla borra la anterior y quitarla borra el objeto", async () => {
    const first = await profile.setAvatar(admin, png, db, { r2 });
    expect(first.startsWith(`_avatars/${admin.id}/`)).toBe(true);
    expect(first.endsWith(".png")).toBe(true);
    expect(s3.objects.has(first)).toBe(true);

    const second = await profile.setAvatar(admin, webp, db, { r2 });
    expect(second.endsWith(".webp")).toBe(true);
    expect(s3.objects.has(first)).toBe(false);
    expect(s3.objects.has(second)).toBe(true);
    expect(await profile.readAvatar(admin.id, db, { r2 })).toMatchObject({ contentType: "image/webp" });

    await profile.removeAvatar(admin, db, { r2 });
    expect(s3.objects.has(second)).toBe(false);
    expect(await profile.readAvatar(admin.id, db, { r2 })).toBeNull();
  });

  it("rechaza lo que no es una imagen admitida o pesa de más, sin tocar R2", async () => {
    await expect(profile.setAvatar(admin, Buffer.from("<svg onload=alert(1)>"), db, { r2 })).rejects.toThrow(/PNG, JPEG o WebP/);
    await expect(profile.setAvatar(admin, Buffer.alloc(1_000_001, 0xff), db, { r2 })).rejects.toThrow(/pesa demasiado/);
    await expect(profile.setAvatar(admin, new Uint8Array(), db, { r2 })).rejects.toThrow(/Elige una foto/);
    expect([...s3.objects.keys()].filter((k) => k.startsWith("_avatars/"))).toHaveLength(0);
  });

  it("la ruta del avatar exige sesión y entrega la foto con su tipo; sin foto, 404", async () => {
    const { GET } = await import("@/app/api/admin/avatar/[id]/route");
    const call = (id: string) => GET(new Request(`https://app.test/api/admin/avatar/${id}`), { params: Promise.resolve({ id }) });
    await profile.setAvatar(admin, png, db); // con el R2 de las variables (el S3 falso)
    session.current = null;
    expect((await call(admin.id)).status).toBe(401);
    session.current = admin;
    const ok = await call(admin.id);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/png");
    expect(ok.headers.get("cache-control")).toContain("private");
    expect(Buffer.from(await ok.arrayBuffer()).equals(png)).toBe(true);
    expect((await call("00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await call("no-es-uuid")).status).toBe(404);
  });
});
