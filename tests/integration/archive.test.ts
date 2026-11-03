import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import * as s from "@/server/db/schema";
import * as archive from "@/server/services/archive";
import * as clients from "@/server/services/clients";
import * as projects from "@/server/services/projects";
import * as routes from "@/server/services/routes";

const dbUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!dbUrl)("archivar, restaurar y eliminar", () => {
  const { db, pool } = createDb(dbUrl ?? "", 4);
  const noQueues = { maintenance: { add: async () => undefined } as never };
  let stored: string[] = [];
  let failR2 = false;
  const r2 = {
    listObjects: async (prefix: string) => {
      if (failR2) throw new Error("R2 caído");
      return stored.filter((k) => k.startsWith(prefix)).map((key) => ({ key, size: 1, lastModified: new Date() }));
    },
    deleteObjects: async (keys: string[]) => {
      stored = stored.filter((k) => !keys.includes(k));
    },
  };

  beforeAll(async () => { await runMigrations(dbUrl!, "./drizzle"); });
  afterAll(() => pool.end());
  beforeEach(async () => {
    await db.execute(sql`truncate clients, settings restart identity cascade`);
    stored = ["acme/tienda/2026/11/a.json.gz", "acme/tienda/2026/11/b.json.gz", "acme/blog/2026/11/c.json.gz", "otro/tienda/2026/11/d.json.gz", "acme-2/x/e.json.gz"];
    failR2 = false;
  });

  async function setup() {
    const client = await clients.createClient({ name: "Acme" }, db);
    const tienda = await projects.createProject(client.id, { name: "Tienda", baseUrl: "https://acme.test" }, db, noQueues);
    const blog = await projects.createProject(client.id, { name: "Blog", baseUrl: "https://blog.acme.test" }, db, noQueues);
    const route = await routes.addRoute(tienda.id, { path: "/" }, db);
    await db.insert(s.auditLogs).values({ projectId: tienda.id, routeId: route.id, profile: "mobile", trigger: "manual", phaseAtRun: "development", status: "succeeded", r2Key: "acme/tienda/2026/11/a.json.gz" });
    return { client, tienda, blog };
  }
  const rejects = async (p: Promise<unknown>, re: RegExp) => expect(p).rejects.toThrow(re);

  describe("listado y restauración", () => {
    it("un proyecto archivado aparece en Archivados y vuelve al restaurarlo", async () => {
      const { tienda, client } = await setup();
      await projects.archiveProject(tienda.id, db, noQueues);
      expect((await archive.listArchivedProjects(db)).map((p) => p.name)).toEqual(["Tienda"]);
      expect(await projects.listProjects(client.id, db)).toHaveLength(1);
      await archive.restoreProject(tienda.id, db, noQueues);
      expect(await archive.listArchivedProjects(db)).toHaveLength(0);
      expect(await projects.listProjects(client.id, db)).toHaveLength(2);
    });

    it("un cliente archivado aparece con todos sus proyectos y vuelve al restaurarlo", async () => {
      const { client, tienda } = await setup();
      await projects.archiveProject(tienda.id, db, noQueues);
      await clients.archiveClient(client.id, db);
      const [archived] = await archive.listArchivedClients(db);
      expect(archived).toMatchObject({ name: "Acme", projectCount: 2 });
      // Los proyectos de un cliente archivado no se listan aparte: viajan con su cliente.
      expect(await archive.listArchivedProjects(db)).toHaveLength(0);
      await rejects(archive.restoreProject(tienda.id, db, noQueues), /Restaura primero al cliente/);
      await archive.restoreClient(client.id, db);
      expect(await archive.listArchivedClients(db)).toHaveLength(0);
      expect((await clients.listClients(db))[0]).toMatchObject({ name: "Acme", projectCount: 1 });
      await archive.restoreProject(tienda.id, db, noQueues);
      expect(await projects.listProjects(client.id, db)).toHaveLength(2);
    });

    it("restaurar algo que no está archivado falla con un mensaje claro", async () => {
      const { client, blog } = await setup();
      await rejects(archive.restoreClient(client.id, db), /no encontrado/);
      await rejects(archive.restoreProject(blog.id, db, noQueues), /no encontrado/);
    });
  });

  describe("eliminación definitiva de un proyecto", () => {
    it("solo se puede eliminar lo archivado", async () => {
      const { tienda } = await setup();
      await rejects(archive.deleteProject(tienda.id, "Tienda", db, { r2 }), /Solo se pueden eliminar proyectos archivados/);
      expect(stored).toHaveLength(5);
    });

    it("pide el nombre exacto y, sin él, no borra nada", async () => {
      const { tienda } = await setup();
      await projects.archiveProject(tienda.id, db, noQueues);
      await rejects(archive.deleteProject(tienda.id, "", db, { r2 }), /nombre exacto/);
      await rejects(archive.deleteProject(tienda.id, "tienda", db, { r2 }), /nombre exacto/);
      expect(await archive.listArchivedProjects(db)).toHaveLength(1);
      expect(stored).toHaveLength(5);
    });

    it("borra el proyecto, sus datos en cascada y solo sus informes de R2", async () => {
      const { tienda, blog, client } = await setup();
      await projects.archiveProject(tienda.id, db, noQueues);
      expect(await archive.deleteProject(tienda.id, "  Tienda ", db, { r2 })).toEqual({ files: 2 });
      expect(stored.sort()).toEqual(["acme-2/x/e.json.gz", "acme/blog/2026/11/c.json.gz", "otro/tienda/2026/11/d.json.gz"].sort());
      expect(await db.select().from(s.projects).where(eq(s.projects.id, tienda.id))).toHaveLength(0);
      expect(await db.select().from(s.routes)).toHaveLength(0);
      expect(await db.select().from(s.auditLogs)).toHaveLength(0);
      expect((await projects.listProjects(client.id, db)).map((p) => p.id)).toEqual([blog.id]);
    });

    it("si R2 falla no se elimina nada de la base de datos", async () => {
      const { tienda } = await setup();
      await projects.archiveProject(tienda.id, db, noQueues);
      failR2 = true;
      await rejects(archive.deleteProject(tienda.id, "Tienda", db, { r2 }), /No se eliminó nada/);
      expect(await archive.listArchivedProjects(db)).toHaveLength(1);
      expect(await db.select().from(s.auditLogs)).toHaveLength(1);
    });

    it("libera el identificador para crear otro proyecto con el mismo nombre", async () => {
      const { tienda, client } = await setup();
      await projects.archiveProject(tienda.id, db, noQueues);
      await archive.deleteProject(tienda.id, "Tienda", db, { r2 });
      expect((await projects.createProject(client.id, { name: "Tienda", baseUrl: "https://acme.test" }, db, noQueues)).slug).toBe("tienda");
    });
  });

  describe("eliminación definitiva de un cliente", () => {
    it("solo se puede eliminar un cliente archivado y con su nombre exacto", async () => {
      const { client } = await setup();
      await rejects(archive.deleteClient(client.id, "Acme", db, { r2 }), /Solo se pueden eliminar clientes archivados/);
      await clients.archiveClient(client.id, db);
      await rejects(archive.deleteClient(client.id, "Acm", db, { r2 }), /nombre exacto/);
      expect(await archive.listArchivedClients(db)).toHaveLength(1);
    });

    it("se lleva todos sus proyectos (archivados o no) y toda su carpeta de R2, sin tocar a otros clientes", async () => {
      const { client, tienda } = await setup();
      await projects.archiveProject(tienda.id, db, noQueues);
      await clients.archiveClient(client.id, db);
      expect(await archive.deleteClient(client.id, "Acme", db, { r2 })).toEqual({ files: 3 });
      expect(stored.sort()).toEqual(["acme-2/x/e.json.gz", "otro/tienda/2026/11/d.json.gz"].sort());
      expect(await db.select().from(s.clients)).toHaveLength(0);
      expect(await db.select().from(s.projects)).toHaveLength(0);
      expect(await db.select().from(s.auditLogs)).toHaveLength(0);
      expect((await clients.createClient({ name: "Acme" }, db)).slug).toBe("acme");
    });

    it("si R2 falla conserva el cliente y sus proyectos", async () => {
      const { client } = await setup();
      await clients.archiveClient(client.id, db);
      failR2 = true;
      await rejects(archive.deleteClient(client.id, "Acme", db, { r2 }), /No se eliminó nada/);
      expect(await db.select().from(s.projects)).toHaveLength(2);
    });
  });
});
