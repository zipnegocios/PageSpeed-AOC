import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { authenticate, resolveSession, seedAdminFromEnv } from "@/server/services/admin-auth";
import { adminUsers } from "@/server/db/schema";
import { hashPassword } from "@/server/auth/password";
import { eq } from "drizzle-orm";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("servicio de autenticación del administrador", () => {
  const { db, pool } = createDb(url ?? "", 2);
  const env = { ADMIN_EMAIL: "  Admin@Example.COM ", ADMIN_PASSWORD: "contraseña-segura-1" };

  beforeAll(async () => {
    await runMigrations(url!, "./drizzle");
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await db.execute(sql`truncate admin_users restart identity cascade`);
  });

  it("crea el admin la primera vez, normalizando el correo, y no repite", async () => {
    expect(await seedAdminFromEnv(env, db)).toBe("created");
    expect(await seedAdminFromEnv(env, db)).toBe("exists");
    const rows = await db.select().from(adminUsers);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.email).toBe("admin@example.com");
    expect(rows[0]!.passwordHash).not.toContain("contraseña-segura-1");
  });

  it("cambiar las variables después no cambia al admin existente", async () => {
    await seedAdminFromEnv(env, db);
    expect(await seedAdminFromEnv({ ADMIN_EMAIL: "otro@x.com", ADMIN_PASSWORD: "otra-contraseña-123" }, db)).toBe("exists");
    expect((await authenticate("admin@example.com", "contraseña-segura-1", db)).ok).toBe(true);
    expect((await authenticate("otro@x.com", "otra-contraseña-123", db)).ok).toBe(false);
  });

  it("no crea admin si faltan variables o la contraseña es corta", async () => {
    expect(await seedAdminFromEnv({}, db)).toBe("missing-env");
    expect(await seedAdminFromEnv({ ADMIN_EMAIL: "a@b.com" }, db)).toBe("missing-env");
    expect(await seedAdminFromEnv({ ADMIN_EMAIL: "a@b.com", ADMIN_PASSWORD: "corta" }, db)).toBe("invalid");
    expect(await seedAdminFromEnv({ ADMIN_EMAIL: "sin-arroba", ADMIN_PASSWORD: "contraseña-larga-1" }, db)).toBe("invalid");
    expect(await db.select().from(adminUsers)).toHaveLength(0);
  });

  it("autentica solo con las credenciales correctas (sin distinguir mayúsculas en el correo)", async () => {
    await seedAdminFromEnv(env, db);
    expect((await authenticate("ADMIN@example.com", "contraseña-segura-1", db)).ok).toBe(true);
    expect((await authenticate("admin@example.com", "incorrecta-123456", db)).ok).toBe(false);
    expect((await authenticate("nadie@example.com", "contraseña-segura-1", db)).ok).toBe(false);
  });

  it("la sesión deja de valer si el admin cambia la contraseña o desaparece", async () => {
    await seedAdminFromEnv(env, db);
    const auth = await authenticate("admin@example.com", "contraseña-segura-1", db);
    if (!auth.ok) throw new Error("debía autenticar");
    const claims = { sub: auth.admin.id, email: auth.admin.email, pv: auth.admin.pv };
    expect(await resolveSession(claims, db)).not.toBeNull();

    await db
      .update(adminUsers)
      .set({ passwordHash: await hashPassword("clave-nueva-123456") })
      .where(eq(adminUsers.id, auth.admin.id));
    expect(await resolveSession(claims, db)).toBeNull();

    await db.delete(adminUsers);
    expect(await resolveSession({ ...claims, pv: "x" }, db)).toBeNull();
  });
});
