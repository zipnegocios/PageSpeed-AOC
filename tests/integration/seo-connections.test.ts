import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { exportPKCS8, generateKeyPair } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import * as s from "@/server/db/schema";
import { isDomainError } from "@/server/domain/errors";
import { clearTokenCache } from "@/server/seo/google-auth";
import type { FetchLike } from "@/server/seo/http";
import * as clients from "@/server/services/clients";
import * as projects from "@/server/services/projects";
import { clearGoogleAccount, getConnections, getGoogleAccount, getSeoOverview, removeConnection, saveConnection, saveGoogleAccount, testConnection } from "@/server/services/seo-connections";

const dbUrl = process.env.TEST_DATABASE_URL;
const KEY = randomBytes(32).toString("base64");
const OTHER = randomBytes(32).toString("base64");
const EMAIL = "pagespeed@demo.iam.gserviceaccount.com";
const ZONE = "a1".repeat(16);
const CF_TOKEN = "cf-token-de-solo-lectura-0123456789";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Google y Cloudflare simulados: cada prueba cambia solo lo que necesita. */
type Fake = {
  tokenStatus: number;
  sites: Array<{ siteUrl: string; permissionLevel: string }>;
  ga4: { status: number; rowCount?: number };
  cfVerify: string;
  cfGraphql: "ok" | "sin-zona";
  calls: string[];
};
const fresh = (): Fake => ({ tokenStatus: 200, sites: [{ siteUrl: "sc-domain:acme.test", permissionLevel: "siteOwner" }], ga4: { status: 200, rowCount: 3 }, cfVerify: "active", cfGraphql: "ok", calls: [] });
let fake = fresh();

const fetchImpl: FetchLike = async (url) => {
  fake.calls.push(url);
  if (url === "https://oauth2.googleapis.com/token") return fake.tokenStatus === 200 ? json({ access_token: "tok", expires_in: 3600 }) : json({ error: "invalid_grant", error_description: "Invalid JWT" }, fake.tokenStatus);
  if (url.endsWith("/webmasters/v3/sites")) return json({ siteEntry: fake.sites });
  if (url.includes(":runReport")) return fake.ga4.status === 200 ? json({ rowCount: fake.ga4.rowCount, rows: [] }) : json({ error: { message: "x" } }, fake.ga4.status);
  if (url.endsWith("/user/tokens/verify")) return json({ result: { status: fake.cfVerify } });
  if (url.endsWith("/client/v4/graphql")) return fake.cfGraphql === "ok" ? json({ data: { viewer: { zones: [{ httpRequestsAdaptiveGroups: [] }] } } }) : json({ data: { viewer: { zones: [] } } });
  throw new Error(`URL inesperada: ${url}`);
};
const deps = { key: KEY, fetchImpl, sleep: async () => undefined };

describe.skipIf(!dbUrl)("conexiones SEO", () => {
  const { db, pool } = createDb(dbUrl ?? "", 4);
  let saKeyJson: string;

  beforeAll(async () => {
    await runMigrations(dbUrl!, "./drizzle");
    const { privateKey } = await generateKeyPair("RS256", { extractable: true });
    saKeyJson = JSON.stringify({ type: "service_account", client_email: EMAIL, private_key: await exportPKCS8(privateKey), token_uri: "https://oauth2.googleapis.com/token" });
  });
  afterAll(() => pool.end());
  beforeEach(async () => {
    fake = fresh();
    clearTokenCache();
    await db.execute(sql`truncate clients, settings restart identity cascade`);
  });

  async function setup() {
    const client = await clients.createClient({ name: "Acme" }, db);
    const project = await projects.createProject(client.id, { name: "Tienda", baseUrl: "https://acme.test" }, db);
    return { client, project };
  }
  const withGoogle = () => saveGoogleAccount(saKeyJson, db, deps);

  describe("cuenta de servicio de Google", () => {
    it("la guarda cifrada, comprueba que Google la acepta y solo muestra el correo", async () => {
      expect(await getGoogleAccount(db, deps)).toEqual({ configured: false });
      expect(await withGoogle()).toEqual({ email: EMAIL });
      expect(await getGoogleAccount(db, deps)).toEqual({ configured: true, email: EMAIL });
      expect(fake.calls).toContain("https://oauth2.googleapis.com/token");
      const [row] = await db.select().from(s.settings).where(eq(s.settings.key, "seo.google_service_account"));
      const stored = JSON.stringify(row!.value);
      expect(stored).not.toContain("PRIVATE KEY");
      expect(stored).not.toContain(JSON.parse(saKeyJson).private_key.slice(40, 80));
      // Con otra clave de cifrado se ve, pero no se puede leer.
      expect(await getGoogleAccount(db, { key: OTHER })).toEqual({ configured: true, email: EMAIL, unreadable: true });
    });

    it("rechaza lo que no es una llave, la que Google no acepta y la falta de clave de cifrado", async () => {
      await expect(saveGoogleAccount("no es json", db, deps)).rejects.toThrow(/JSON válido/);
      await expect(saveGoogleAccount(JSON.stringify({ client_email: EMAIL }), db, deps)).rejects.toThrow(/private_key/);
      fake.tokenStatus = 400;
      await expect(saveGoogleAccount(saKeyJson, db, deps)).rejects.toThrow(/Google rechazó la llave/);
      fake.tokenStatus = 200;
      await expect(saveGoogleAccount(saKeyJson, db, { ...deps, key: "corta" })).rejects.toThrow(/AUTH_ENCRYPTION_KEY/);
      expect(await getGoogleAccount(db, deps)).toEqual({ configured: false });
    });

    it("se puede quitar", async () => {
      await withGoogle();
      await clearGoogleAccount(db);
      expect(await getGoogleAccount(db, deps)).toEqual({ configured: false });
    });
  });

  describe("guardar conexiones", () => {
    it("normaliza los identificadores y deja la conexión pendiente", async () => {
      const { project } = await setup();
      expect(await getConnections(project.id, db)).toEqual({ gsc: null, ga4: null, cloudflare: null });
      const gsc = await saveConnection(project.id, "gsc", { externalId: "Acme.test" }, db, deps);
      expect(gsc).toMatchObject({ kind: "gsc", externalId: "sc-domain:acme.test", status: "pending", hasCredential: false, detail: null });
      const ga4 = await saveConnection(project.id, "ga4", { externalId: "properties/123456789" }, db, deps);
      expect(ga4.externalId).toBe("123456789");
      const all = await getConnections(project.id, db);
      expect(all.gsc?.externalId).toBe("sc-domain:acme.test");
      expect(all.cloudflare).toBeNull();
    });

    it("rechaza identificadores y proyectos inválidos con mensajes claros", async () => {
      const { project } = await setup();
      await expect(saveConnection(project.id, "ga4", { externalId: "G-ABC123" }, db, deps)).rejects.toThrow(/ID de medición/);
      await expect(saveConnection(project.id, "otro", { externalId: "x" }, db, deps)).rejects.toThrow(/desconocido/);
      await expect(saveConnection("no-uuid", "gsc", { externalId: "acme.test" }, db, deps)).rejects.toThrow(/Proyecto no encontrado/);
      await expect(saveConnection("0198a1b2-0000-7000-8000-000000000000", "gsc", { externalId: "acme.test" }, db, deps)).rejects.toThrow(/Proyecto no encontrado/);
    });

    it("el token de Cloudflare se guarda cifrado, se conserva al editar la zona y es obligatorio la primera vez", async () => {
      const { project } = await setup();
      await expect(saveConnection(project.id, "cloudflare", { externalId: ZONE }, db, deps)).rejects.toThrow(/Pega el token/);
      const first = await saveConnection(project.id, "cloudflare", { externalId: ZONE, token: CF_TOKEN }, db, deps);
      expect(first.hasCredential).toBe(true);
      const [row] = await db.select().from(s.seoIntegrations).where(eq(s.seoIntegrations.projectId, project.id));
      expect(row!.credentialEnc!.toString("latin1")).not.toContain("cf-token");
      expect(JSON.stringify(first)).not.toContain("cf-token");

      const otherZone = "b2".repeat(16);
      const edited = await saveConnection(project.id, "cloudflare", { externalId: otherZone }, db, deps);
      expect(edited).toMatchObject({ externalId: otherZone, hasCredential: true, status: "pending" });
      await expect(saveConnection(project.id, "cloudflare", { externalId: ZONE, token: "corto" }, db, deps)).rejects.toThrow(/no parece válido/);
    });

    it("la clave de cifrado debe existir para guardar un token", async () => {
      const { project } = await setup();
      await expect(saveConnection(project.id, "cloudflare", { externalId: ZONE, token: CF_TOKEN }, db, { ...deps, key: undefined })).rejects.toThrow(/AUTH_ENCRYPTION_KEY/);
    });

    it("se puede quitar y avisa si no existe", async () => {
      const { project } = await setup();
      await saveConnection(project.id, "gsc", { externalId: "acme.test" }, db, deps);
      await removeConnection(project.id, "gsc", db);
      expect((await getConnections(project.id, db)).gsc).toBeNull();
      await expect(removeConnection(project.id, "gsc", db)).rejects.toThrow(/no existe/);
    });

    it("al borrar el proyecto se borran sus conexiones", async () => {
      const { project } = await setup();
      await saveConnection(project.id, "gsc", { externalId: "acme.test" }, db, deps);
      await db.delete(s.projects).where(eq(s.projects.id, project.id));
      expect(await db.select().from(s.seoIntegrations)).toHaveLength(0);
    });
  });

  describe("probar la conexión", () => {
    it("Search Console: acceso correcto y lo anota", async () => {
      const { project } = await setup();
      await withGoogle();
      await saveConnection(project.id, "gsc", { externalId: "acme.test" }, db, deps);
      const now = new Date("2026-11-10T12:00:00Z");
      expect(await testConnection(project.id, "gsc", db, { ...deps, now: () => now })).toEqual({ ok: true, detail: "Acceso correcto como propietario." });
      expect((await getConnections(project.id, db)).gsc).toMatchObject({ status: "ok", lastCheckedAt: now, lastOkAt: now, detail: "Acceso correcto como propietario." });
    });

    it("Search Console: si la cuenta no ve la propiedad, dice qué correo agregar y qué ve hoy", async () => {
      const { project } = await setup();
      await withGoogle();
      await saveConnection(project.id, "gsc", { externalId: "https://otro.test/" }, db, deps);
      const r = await testConnection(project.id, "gsc", db, deps);
      expect(r.ok).toBe(false);
      expect(r.detail).toContain(EMAIL);
      expect(r.detail).toContain("sc-domain:acme.test");
      expect((await getConnections(project.id, db)).gsc).toMatchObject({ status: "error" });
      fake.sites = [];
      expect((await testConnection(project.id, "gsc", db, deps)).detail).toMatch(/no ve ninguna propiedad/);
    });

    it("GA4: acceso correcto, sin permiso y propiedad inexistente", async () => {
      const { project } = await setup();
      await withGoogle();
      await saveConnection(project.id, "ga4", { externalId: "123456789" }, db, deps);
      expect(await testConnection(project.id, "ga4", db, deps)).toMatchObject({ ok: true, detail: expect.stringContaining("responde con datos") });
      fake.ga4 = { status: 200, rowCount: 0 };
      expect((await testConnection(project.id, "ga4", db, deps)).detail).toMatch(/no tiene datos/);
      fake.ga4 = { status: 403 };
      const denied = await testConnection(project.id, "ga4", db, deps);
      expect(denied.ok).toBe(false);
      expect(denied.detail).toContain(EMAIL);
      expect(denied.detail).toMatch(/rol Lector/);
      fake.ga4 = { status: 404 };
      expect((await testConnection(project.id, "ga4", db, deps)).detail).toMatch(/ID numérico/);
    });

    it("sin cuenta de Google configurada lo dice, y una llave que Google ya no acepta también", async () => {
      const { project } = await setup();
      await saveConnection(project.id, "ga4", { externalId: "123456789" }, db, deps);
      expect((await testConnection(project.id, "ga4", db, deps)).detail).toMatch(/Falta la cuenta de servicio de Google/);
      await withGoogle();
      clearTokenCache();
      fake.tokenStatus = 400;
      expect((await testConnection(project.id, "ga4", db, deps)).detail).toMatch(/no aceptó la cuenta de servicio/);
      expect((await testConnection(project.id, "ga4", db, { ...deps, key: OTHER })).detail).toMatch(/AUTH_ENCRYPTION_KEY/);
    });

    it("un límite de consultas o una caída de Google se explican sin tecnicismos", async () => {
      const { project } = await setup();
      await withGoogle();
      await saveConnection(project.id, "ga4", { externalId: "123456789" }, db, deps);
      fake.ga4 = { status: 429 };
      expect((await testConnection(project.id, "ga4", db, deps)).detail).toMatch(/pide esperar/);
      fake.ga4 = { status: 503 };
      expect((await testConnection(project.id, "ga4", db, deps)).detail).toMatch(/No se pudo contactar/);
    });

    it("Cloudflare: token activo, token inactivo y zona que el token no ve", async () => {
      const { project } = await setup();
      await saveConnection(project.id, "cloudflare", { externalId: ZONE, token: CF_TOKEN }, db, deps);
      expect(await testConnection(project.id, "cloudflare", db, deps)).toEqual({ ok: true, detail: "Token activo y la zona responde." });
      fake.cfVerify = "disabled";
      expect((await testConnection(project.id, "cloudflare", db, deps)).detail).toMatch(/no está activo/);
      fake.cfVerify = "active";
      fake.cfGraphql = "sin-zona";
      expect((await testConnection(project.id, "cloudflare", db, deps)).detail).toMatch(/permiso de lectura de analíticas/);
      expect((await testConnection(project.id, "cloudflare", db, { ...deps, key: OTHER })).detail).toMatch(/AUTH_ENCRYPTION_KEY/);
    });

    it("nada de lo anotado ni lo devuelto contiene credenciales", async () => {
      const { project } = await setup();
      await withGoogle();
      await saveConnection(project.id, "cloudflare", { externalId: ZONE, token: CF_TOKEN }, db, deps);
      fake.cfVerify = "disabled";
      const r = await testConnection(project.id, "cloudflare", db, deps);
      const rows = await db.select().from(s.seoIntegrations);
      for (const text of [JSON.stringify(r), JSON.stringify(rows.map((x) => ({ ...x, credentialEnc: null })))]) {
        expect(text).not.toContain(CF_TOKEN);
        expect(text).not.toContain("PRIVATE KEY");
      }
    });

    it("pide guardar la conexión antes de probarla", async () => {
      const { project } = await setup();
      await expect(testConnection(project.id, "gsc", db, deps)).rejects.toSatisfy((e) => isDomainError(e) && /Primero guarda/.test((e as Error).message));
    });
  });

  it("el resumen lista los proyectos con el estado de cada conexión", async () => {
    const { project, client } = await setup();
    const other = await projects.createProject(client.id, { name: "Blog", baseUrl: "https://blog.acme.test" }, db);
    await withGoogle();
    await saveConnection(project.id, "gsc", { externalId: "acme.test" }, db, deps);
    await saveConnection(project.id, "ga4", { externalId: "123456789" }, db, deps);
    await testConnection(project.id, "gsc", db, deps);
    const overview = await getSeoOverview(db);
    const tienda = overview.find((p) => p.id === project.id)!;
    expect(tienda.connections).toEqual({ gsc: "ok", ga4: "pending", cloudflare: null });
    expect(tienda).toMatchObject({ name: "Tienda", clientName: "Acme", clientSlug: client.slug });
    expect(overview.find((p) => p.id === other.id)!.connections).toEqual({ gsc: null, ga4: null, cloudflare: null });
  });
});
