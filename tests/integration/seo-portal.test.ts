import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import * as s from "@/server/db/schema";
import * as clients from "@/server/services/clients";
import * as projects from "@/server/services/projects";
import { getPortalSeoDashboard, getSeoSharing, setSeoClientVisible } from "@/server/services/seo-portal";

const dbUrl = process.env.TEST_DATABASE_URL;
const DAY = "2026-06-30";

describe.skipIf(!dbUrl)("SEO en el portal del cliente", () => {
  const { db, pool } = createDb(dbUrl ?? "", 4);
  let clientId: string;
  let otherClientId: string;
  let projectId: string;

  beforeAll(async () => {
    await runMigrations(dbUrl!, "./drizzle");
  });
  afterAll(() => pool.end());
  beforeEach(async () => {
    await db.execute(sql`truncate clients, settings restart identity cascade`);
    clientId = (await clients.createClient({ name: "Acme" }, db)).id;
    otherClientId = (await clients.createClient({ name: "Otro" }, db)).id;
    // En producción y con datos descargados: lo único que falta para que el cliente lo vea es que el administrador lo active.
    projectId = (await projects.createProject(clientId, { name: "Tienda", baseUrl: "https://acme.test", phase: "production" }, db)).id;
    await db.insert(s.seoIntegrations).values({ projectId, kind: "gsc", externalId: "sc-domain:acme.test", status: "ok", syncedThrough: DAY, syncStatus: "ok" });
    await db.insert(s.seoSearchDaily).values({ projectId, date: DAY, page: "/es", country: "col", device: "MOBILE", clicks: 5, impressions: 50, positionSum: 150 });
  });

  const ask = (client = clientId, project = projectId) => getPortalSeoDashboard(client, project, { days: 28 }, db);

  it("por defecto está oculto: el cliente no recibe nada aunque haya datos", async () => {
    expect(await getSeoSharing(projectId, db)).toEqual({ visible: false, inProduction: true });
    expect(await ask()).toBeNull();
  });

  it("al activarlo, el cliente recibe el panel, y al ocultarlo deja de recibirlo", async () => {
    await setSeoClientVisible(projectId, true, db);
    const d = await ask();
    expect(d?.search?.totals.clicks).toBe(5);
    expect((await getSeoSharing(projectId, db)).visible).toBe(true);
    await setSeoClientVisible(projectId, false, db);
    expect(await ask()).toBeNull();
  });

  it("otro cliente no ve el proyecto aunque conozca su identificador", async () => {
    await setSeoClientVisible(projectId, true, db);
    expect(await ask(otherClientId)).toBeNull();
  });

  it("un proyecto en desarrollo se muestra si el administrador lo activó; uno archivado no", async () => {
    await setSeoClientVisible(projectId, true, db);
    await db.execute(sql`update projects set phase = 'development' where id = ${projectId}`);
    expect(await ask()).not.toBeNull();
    expect((await getSeoSharing(projectId, db)).inProduction).toBe(false);
    await db.execute(sql`update projects set phase = 'production', deleted_at = now() where id = ${projectId}`);
    expect(await ask()).toBeNull();
  });

  it("sin conexión a Search Console ni a GA4 no hay nada que mostrar", async () => {
    await setSeoClientVisible(projectId, true, db);
    await db.execute(sql`delete from seo_integrations`);
    expect(await ask()).toBeNull();
  });

  it("rechaza identificadores inválidos y proyectos inexistentes", async () => {
    await expect(ask(clientId, "no-uuid")).rejects.toThrow(/Proyecto no encontrado/);
    await expect(setSeoClientVisible("00000000-0000-4000-8000-000000000000", true, db)).rejects.toThrow(/Proyecto no encontrado/);
    await expect(getSeoSharing("00000000-0000-4000-8000-000000000000", db)).rejects.toThrow(/Proyecto no encontrado/);
  });
});
