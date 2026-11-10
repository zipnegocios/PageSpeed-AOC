import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFakeS3, type FakeS3 } from "../helpers/fake-s3";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import * as clientLogo from "@/server/services/client-logo";
import * as clients from "@/server/services/clients";
import * as portal from "@/server/services/portal";
import { generateClientPin } from "@/server/services/portal-pin";
import { createR2, type R2Store } from "@/server/storage/r2";

const url = process.env.TEST_DATABASE_URL;

function png(width: number, height: number): Buffer {
  const b = Buffer.alloc(40);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

describe.skipIf(!url)("logotipos de cliente", () => {
  const { db, pool } = createDb(url ?? "", 4);
  let s3: FakeS3;
  let r2: R2Store;
  const deps = () => ({ r2 });
  const logoKeys = () => [...s3.objects.keys()].filter((k) => k.startsWith("_logos/"));

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
    await db.execute(sql`truncate clients, settings restart identity cascade`);
    s3.objects.clear();
  });

  it("guarda cada versión bajo _logos/<cliente>/, reemplazar borra el objeto anterior y quitar borra el objeto", async () => {
    const c = await clients.createClient({ name: "Acme" }, db);
    await clientLogo.setClientLogo(c.id, "icon", png(256, 256), db, deps());
    await clientLogo.setClientLogo(c.id, "full", png(800, 300), db, deps());
    expect(logoKeys()).toHaveLength(2);
    expect(logoKeys().every((k) => k.startsWith(`_logos/${c.id}/`))).toBe(true);
    const first = logoKeys().find((k) => k.includes("/icon-"))!;

    await clientLogo.setClientLogo(c.id, "icon", png(512, 512), db, deps());
    expect(logoKeys()).toHaveLength(2);
    expect(logoKeys()).not.toContain(first);
    expect((await clientLogo.readClientLogo(c.id, "icon", db, deps()))?.contentType).toBe("image/png");

    await clientLogo.removeClientLogo(c.id, "icon", db, deps());
    expect(logoKeys()).toHaveLength(1);
    expect(await clientLogo.readClientLogo(c.id, "icon", db, deps())).toBeNull();
    expect(await clientLogo.readClientLogo(c.id, "full", db, deps())).not.toBeNull();
  });

  it("rechaza lo que no es un PNG válido sin dejar objetos huérfanos y no toca el logotipo vigente", async () => {
    const c = await clients.createClient({ name: "Acme" }, db);
    await clientLogo.setClientLogo(c.id, "full", png(800, 300), db, deps());
    await expect(clientLogo.setClientLogo(c.id, "full", Buffer.from("<svg onload=alert(1)>"), db, deps())).rejects.toThrow(/PNG/);
    await expect(clientLogo.setClientLogo(c.id, "icon", png(900, 200), db, deps())).rejects.toThrow(/casi cuadrado/);
    expect(logoKeys()).toHaveLength(1);
    expect(await clientLogo.readClientLogo(c.id, "full", db, deps())).not.toBeNull();
  });

  it("una clave colgante (objeto perdido en R2) se trata como «sin logotipo»", async () => {
    const c = await clients.createClient({ name: "Acme" }, db);
    await clientLogo.setClientLogo(c.id, "icon", png(256, 256), db, deps());
    s3.objects.clear();
    expect(await clientLogo.readClientLogo(c.id, "icon", db, deps())).toBeNull();
    expect(await clientLogo.readPwaIconSource("acme", db, deps())).toBeNull();
  });

  it("el color de fondo se valida y se guarda; la fuente del icono usa el isotipo y, a falta, el logotipo completo", async () => {
    const c = await clients.createClient({ name: "Acme" }, db);
    await expect(clientLogo.setClientLogoBg(c.id, "azul", db)).rejects.toThrow(/#RRGGBB/);
    await clientLogo.setClientLogo(c.id, "full", png(800, 300), db, deps());
    await clientLogo.setClientLogoBg(c.id, "#111827", db);
    expect(await clientLogo.readPwaIconSource(c.slug, db, deps())).toMatchObject({ bg: "#111827" });
    await clientLogo.setClientLogoBg(c.id, "", db);
    expect(await clientLogo.readPwaIconSource(c.slug, db, deps())).toMatchObject({ bg: null });
    await clients.setClientStatus(c.id, "suspended", db);
    expect(await clientLogo.readPwaIconSource(c.slug, db, deps())).toBeNull(); // suspendido: sin icono propio
  });

  it("el portal entrega el logotipo solo con el acceso concedido: nunca en PIN, ni de otro cliente", async () => {
    const a = await clients.createClient({ name: "Acme" }, db);
    const b = await clients.createClient({ name: "Beta" }, db);
    await generateClientPin(a.id, {}, db, { secret: "s".repeat(40) });
    await clientLogo.setClientLogo(a.id, "icon", png(256, 256), db, deps());
    await clientLogo.setClientLogoBg(a.id, "#1F2937", db);
    const ok = await portal.resolvePortal(a.slug, async () => true, db);
    expect(ok).toMatchObject({ state: "ok", client: { id: a.id, logo: { icon: true, full: false, bg: "#1F2937" } } });
    expect(await portal.resolvePortal(a.slug, async () => false, db)).toEqual({ state: "pin" }); // sin sesión: nada del cliente
    // Un cliente sin logotipo no lleva la clave `logo`; el de otro cliente no se filtra.
    await generateClientPin(b.id, {}, db, { secret: "s".repeat(40) });
    const other = await portal.resolvePortal(b.slug, async () => true, db);
    expect(other.state === "ok" && other.client.logo).toBeFalsy();
    expect(await clientLogo.readClientLogo(b.id, "icon", db, deps())).toBeNull();
  });

  it("un cliente que no existe no acepta logotipos", async () => {
    await expect(clientLogo.setClientLogo("00000000-0000-4000-8000-000000000000", "icon", png(64, 64), db, deps())).rejects.toThrow(/no encontrado/);
    expect(logoKeys()).toHaveLength(0);
  });
});
