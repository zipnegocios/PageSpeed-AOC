import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import * as s from "@/server/db/schema";
import * as clients from "@/server/services/clients";
import * as projects from "@/server/services/projects";
import * as routes from "@/server/services/routes";
import * as thresholds from "@/server/services/thresholds";
import { discoverRoutes, importRoutes } from "@/server/services/sitemap-discovery";

const url = process.env.TEST_DATABASE_URL;

const rejectsWith = async (p: Promise<unknown>, code: string, text?: RegExp) => {
  await expect(p).rejects.toMatchObject({ name: "DomainError", code });
  if (text) await expect(p).rejects.toThrow(text);
};

describe.skipIf(!url)("servicios de dominio", () => {
  const { db, pool } = createDb(url ?? "", 3);

  beforeAll(async () => {
    await runMigrations(url!, "./drizzle");
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await db.execute(sql`truncate clients, settings restart identity cascade`);
  });

  const newClient = (name = "Café Ñandú") => clients.createClient({ name }, db);

  describe("clientes", () => {
    it("crea con identificador derivado del nombre y un link mágico propio", async () => {
      const c = await newClient();
      expect(c.slug).toBe("cafe-nandu");
      expect(c.status).toBe("active");
      expect(c.magicToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it("resuelve nombres repetidos con sufijo y rechaza identificadores manuales ocupados", async () => {
      expect((await newClient("Acme")).slug).toBe("acme");
      expect((await newClient("Acme")).slug).toBe("acme-2");
      expect((await newClient("ACME")).slug).toBe("acme-3");
      await rejectsWith(clients.createClient({ name: "Otro", slug: "acme" }, db), "CONFLICT");
      await rejectsWith(clients.createClient({ name: "Otro", slug: "MAL SLUG" }, db), "INVALID");
    });

    it("valida los datos de contacto con mensajes legibles", async () => {
      await rejectsWith(clients.createClient({ name: "A" }, db), "INVALID", /al menos 2/);
      await rejectsWith(clients.createClient({ name: "Acme", contactEmail: "no-es-correo" }, db), "INVALID", /correo/);
      await rejectsWith(clients.createClient({ name: "Acme", contactPhone: "abc" }, db), "INVALID", /teléfono/);
      const c = await clients.createClient({ name: "Acme", contactEmail: "  Ventas@ACME.com ", contactPhone: "+34 600 123 456", notes: "" }, db);
      expect(c.contactEmail).toBe("ventas@acme.com");
      expect(c.notes).toBeNull();
    });

    it("editar no cambia el identificador ni el token heredado; suspender sí hace su trabajo", async () => {
      const c = await newClient("Acme");
      const edited = await clients.updateClient(c.id, { name: "Acme SA", slug: "otro", magicToken: "x" }, db);
      expect(edited).toMatchObject({ name: "Acme SA", slug: "acme", magicToken: c.magicToken });

      expect((await clients.setClientStatus(c.id, "suspended", db)).status).toBe("suspended");
      expect((await clients.setClientStatus(c.id, "active", db)).status).toBe("active");
      await rejectsWith(clients.setClientStatus(c.id, "otro" as never, db), "INVALID");

    });

    it("renombrar el identificador deja el anterior como alias reservado y vuelve a funcionar al regresar a él", async () => {
      const a = await newClient("Acme");
      const b = await newClient("Beta");
      const renamed = await clients.renameClientSlug(a.id, " acme-corp ", db);
      expect(renamed).toMatchObject({ slug: "acme-corp", slugAliases: ["acme"] });
      expect((await clients.getClientByRef("acme", db)).id).toBe(a.id); // enlace viejo
      expect((await clients.getClientByRef("acme-corp", db)).id).toBe(a.id);
      // el anterior queda reservado: nadie más (ni al crear ni al renombrar) puede tomarlo
      await rejectsWith(clients.renameClientSlug(b.id, "acme", db), "CONFLICT");
      await rejectsWith(clients.createClient({ name: "Otro", slug: "acme" }, db), "CONFLICT");
      expect((await newClient("Acme")).slug).toBe("acme-2");
      await rejectsWith(clients.renameClientSlug(b.id, "acme-corp", db), "CONFLICT");
      await rejectsWith(clients.renameClientSlug(b.id, "Mal Slug", db), "INVALID");
      await rejectsWith(clients.renameClientSlug(b.id, "a", db), "INVALID");
      // igual al actual no hace nada; volver a uno anterior propio lo saca de los alias
      expect((await clients.renameClientSlug(a.id, "acme-corp", db)).slugAliases).toEqual(["acme"]);
      expect(await clients.renameClientSlug(a.id, "acme", db)).toMatchObject({ slug: "acme", slugAliases: ["acme-corp"] });
    });

    it("un cliente se encuentra por su slug o, en enlaces antiguos, por su UUID; los archivados no", async () => {
      const c = await newClient("Acme");
      expect((await clients.getClientByRef("acme", db)).id).toBe(c.id);
      expect((await clients.getClientByRef(c.id, db)).id).toBe(c.id);
      await rejectsWith(clients.getClientByRef("otro", db), "NOT_FOUND");
      await clients.archiveClient(c.id, db);
      await rejectsWith(clients.getClientByRef("acme", db), "NOT_FOUND");
    });

    it("archivar lo oculta pero conserva el identificador reservado", async () => {
      const c = await newClient("Acme");
      await clients.archiveClient(c.id, db);
      expect(await clients.listClients(db)).toHaveLength(0);
      await rejectsWith(clients.getClient(c.id, db), "NOT_FOUND");
      expect((await newClient("Acme")).slug).toBe("acme-2");
    });

    it("trata ids inválidos o inexistentes como no encontrados", async () => {
      await rejectsWith(clients.getClient("no-es-uuid", db), "NOT_FOUND");
      await rejectsWith(clients.getClient("11111111-1111-4111-8111-111111111111", db), "NOT_FOUND");
    });

    it("lista con el número de proyectos activos", async () => {
      const c = await newClient("Acme");
      await projects.createProject(c.id, { name: "Web", baseUrl: "https://acme.test" }, db);
      const p2 = await projects.createProject(c.id, { name: "Tienda", baseUrl: "https://tienda.acme.test" }, db);
      await projects.archiveProject(p2.id, db);
      expect((await clients.listClients(db))[0]).toMatchObject({ name: "Acme", projectCount: 1 });
    });
  });

  describe("proyectos", () => {
    it("renombrar un proyecto: el anterior sigue resolviendo, queda reservado dentro del cliente y es libre en otros", async () => {
      const acme = await newClient("Acme");
      const otro = await newClient("Otro");
      const p = await projects.createProject(acme.id, { name: "Sitio web", baseUrl: "https://acme.test" }, db);
      const q = await projects.createProject(acme.id, { name: "Blog", baseUrl: "https://blog.acme.test" }, db);
      const renamed = await projects.renameProjectSlug(p.id, "web", db);
      expect(renamed).toMatchObject({ slug: "web", slugAliases: ["sitio-web"] });
      expect((await projects.getProjectByRef("acme", "sitio-web", db)).id).toBe(p.id);
      expect((await projects.getProjectByRef("acme", "web", db)).slug).toBe("web");
      await rejectsWith(projects.renameProjectSlug(q.id, "sitio-web", db), "CONFLICT");
      await rejectsWith(projects.renameProjectSlug(q.id, "web", db), "CONFLICT");
      await rejectsWith(projects.renameProjectSlug(q.id, "NO", db), "INVALID");
      // en otro cliente el nombre sí está libre
      const ajeno = await projects.createProject(otro.id, { name: "Sitio web", baseUrl: "https://otro.test" }, db);
      expect(ajeno.slug).toBe("sitio-web");
      expect(await projects.renameProjectSlug(p.id, "sitio-web", db)).toMatchObject({ slug: "sitio-web", slugAliases: ["web"] });
    });

    it("un proyecto se encuentra por (cliente, proyecto) en slug o UUID, y solo dentro de su cliente", async () => {
      const acme = await newClient("Acme");
      const otro = await newClient("Otro");
      const p = await projects.createProject(acme.id, { name: "Sitio web", baseUrl: "https://acme.test" }, db);
      await projects.createProject(otro.id, { name: "Sitio web", baseUrl: "https://otro.test" }, db); // mismo slug, otro cliente
      expect((await projects.getProjectByRef("acme", "sitio-web", db)).id).toBe(p.id);
      expect((await projects.getProjectByRef(acme.id, p.id, db)).id).toBe(p.id);
      expect((await projects.getProjectByRef("acme", p.id, db)).clientSlug).toBe("acme");
      expect((await projects.getProjectByRef("otro", "sitio-web", db)).id).not.toBe(p.id);
      await rejectsWith(projects.getProjectByRef("otro", p.id, db), "NOT_FOUND"); // UUID de un proyecto ajeno
      await rejectsWith(projects.getProjectByRef("acme", "no-existe", db), "NOT_FOUND");
      await projects.archiveProject(p.id, db);
      await rejectsWith(projects.getProjectByRef("acme", "sitio-web", db), "NOT_FOUND");
    });

    it("crea en desarrollo, deja solo el origen y siembra los 4 umbrales", async () => {
      const c = await newClient("Acme");
      const p = await projects.createProject(c.id, { name: "Sitio web", baseUrl: " https://WWW.Acme.test/es/inicio?x=1 " }, db);
      expect(p).toMatchObject({
        slug: "sitio-web",
        baseUrl: "https://www.acme.test",
        phase: "development",
        auditFrequency: "weekly",
        allowedHosts: ["www.acme.test"],
      });
      const t = await thresholds.getThresholds(p.id, db);
      expect(t.map((x) => [x.metric, x.minScore, x.enabled])).toEqual([
        ["performance", 80, true],
        ["seo", 90, true],
        ["accessibility", 90, true],
        ["best_practices", 90, true],
      ]);
    });

    it("usa los umbrales por defecto guardados en ajustes", async () => {
      await db.insert(s.settings).values({ key: "default_thresholds", value: { performance: 70, seo: 85, accessibility: 95, best_practices: 88 } });
      const c = await newClient("Acme");
      const p = await projects.createProject(c.id, { name: "Web", baseUrl: "https://acme.test" }, db);
      expect((await thresholds.getThresholds(p.id, db)).map((x) => x.minScore)).toEqual([70, 85, 95, 88]);
    });

    it("permite crear directo en producción y valida las URLs", async () => {
      const c = await newClient("Acme");
      const p = await projects.createProject(c.id, { name: "Web", baseUrl: "https://acme.test", phase: "production", auditFrequency: "daily" }, db);
      expect(p).toMatchObject({ phase: "production", auditFrequency: "daily" });
      await rejectsWith(projects.createProject(c.id, { name: "X1", baseUrl: "ftp://acme.test" }, db), "INVALID");
      await rejectsWith(projects.createProject(c.id, { name: "X2", baseUrl: "no-es-url" }, db), "INVALID");
      await rejectsWith(projects.createProject(c.id, { name: "X3", baseUrl: "https://acme.test", sitemapUrl: "javascript:1" }, db), "INVALID");
      await rejectsWith(projects.createProject("11111111-1111-4111-8111-111111111111", { name: "X4", baseUrl: "https://a.test" }, db), "NOT_FOUND");
    });

    it("el identificador es único por cliente, no global", async () => {
      const a = await newClient("Uno");
      const b = await newClient("Dos");
      expect((await projects.createProject(a.id, { name: "Web", baseUrl: "https://a.test" }, db)).slug).toBe("web");
      expect((await projects.createProject(a.id, { name: "Web", baseUrl: "https://a.test" }, db)).slug).toBe("web-2");
      expect((await projects.createProject(b.id, { name: "Web", baseUrl: "https://b.test" }, db)).slug).toBe("web");
      await rejectsWith(projects.createProject(a.id, { name: "Otra", slug: "web", baseUrl: "https://a.test" }, db), "CONFLICT");
    });

    it("actualiza y siempre incluye el host del sitio entre los permitidos", async () => {
      const c = await newClient("Acme");
      const p = await projects.createProject(c.id, { name: "Web", baseUrl: "https://acme.test" }, db);
      const u = await projects.updateProject(
        p.id,
        { name: "Web 2", baseUrl: "https://www.acme.test/", auditFrequency: "daily", sitemapUrl: "", allowedHosts: "https://blog.acme.test/x, *.cdn.acme.test\nacme.test" },
        db,
      );
      expect(u.allowedHosts.sort()).toEqual(["*.cdn.acme.test", "acme.test", "blog.acme.test", "www.acme.test"]);
      expect(u).toMatchObject({ name: "Web 2", auditFrequency: "daily", baseUrl: "https://www.acme.test", sitemapUrl: null });
      await rejectsWith(
        projects.updateProject(p.id, { name: "Web", baseUrl: "https://acme.test", auditFrequency: "weekly", allowedHosts: "host con espacios!, 10.0.0.1/x" }, db),
        "INVALID",
        /no es un host válido/,
      );
      // Los espacios no separan hosts: "host con espacios" no se acepta como tres hosts sueltos.
      await rejectsWith(
        projects.updateProject(p.id, { name: "Web", baseUrl: "https://acme.test", auditFrequency: "weekly", allowedHosts: "host con espacios" }, db),
        "INVALID",
        /no es un host válido/,
      );
    });

    it("pasar a desarrollo silencia las alertas abiertas; pasar a producción no toca nada", async () => {
      const c = await newClient("Acme");
      const p = await projects.createProject(c.id, { name: "Web", baseUrl: "https://acme.test", phase: "production" }, db);
      const [route] = await db.insert(s.routes).values({ projectId: p.id, path: "/", url: "https://acme.test/" }).returning();
      await db.insert(s.alertStates).values([
        { projectId: p.id, routeId: route!.id, profile: "mobile", kind: "threshold", metric: "performance" },
        { projectId: p.id, routeId: route!.id, profile: "desktop", kind: "audit_failure" },
      ]);

      const toDev = await projects.setProjectPhase(p.id, "development", db);
      expect(toDev).toMatchObject({ suppressedAlerts: 2, project: { phase: "development" } });
      const states = await db.select().from(s.alertStates);
      expect(states.every((a) => a.status === "suppressed")).toBe(true);

      const toProd = await projects.setProjectPhase(p.id, "production", db);
      expect(toProd.suppressedAlerts).toBe(0);
      expect((await projects.setProjectPhase(p.id, "production", db)).suppressedAlerts).toBe(0);
      await rejectsWith(projects.setProjectPhase(p.id, "staging", db), "INVALID");
    });

    it("archivar lo oculta", async () => {
      const c = await newClient("Acme");
      const p = await projects.createProject(c.id, { name: "Web", baseUrl: "https://acme.test" }, db);
      await projects.archiveProject(p.id, db);
      await rejectsWith(projects.getProject(p.id, db), "NOT_FOUND");
      expect(await projects.listProjects(c.id, db)).toHaveLength(0);
    });
  });

  describe("umbrales", () => {
    it("son independientes por proyecto y métrica", async () => {
      const c = await newClient("Acme");
      const a = await projects.createProject(c.id, { name: "Sitio A", baseUrl: "https://a.test" }, db);
      const b = await projects.createProject(c.id, { name: "Sitio B", baseUrl: "https://b.test" }, db);
      await thresholds.setThresholds(a.id, [{ metric: "performance", minScore: 55, enabled: true }, { metric: "seo", minScore: 100, enabled: false }], db);
      const ta = await thresholds.getThresholds(a.id, db);
      expect(ta.find((t) => t.metric === "performance")).toMatchObject({ minScore: 55, enabled: true });
      expect(ta.find((t) => t.metric === "seo")).toMatchObject({ minScore: 100, enabled: false });
      expect(ta.find((t) => t.metric === "accessibility")?.minScore).toBe(90);
      expect((await thresholds.getThresholds(b.id, db)).find((t) => t.metric === "performance")?.minScore).toBe(80);
    });

    it("rechaza valores fuera de rango, métricas repetidas y proyectos inexistentes", async () => {
      const c = await newClient("Acme");
      const p = await projects.createProject(c.id, { name: "Sitio A", baseUrl: "https://a.test" }, db);
      await rejectsWith(thresholds.setThresholds(p.id, [{ metric: "seo", minScore: 101, enabled: true }], db), "INVALID", /máximo es 100/);
      await rejectsWith(thresholds.setThresholds(p.id, [{ metric: "seo", minScore: -1, enabled: true }], db), "INVALID");
      await rejectsWith(thresholds.setThresholds(p.id, [{ metric: "seo", minScore: "abc", enabled: true }], db), "INVALID");
      await rejectsWith(
        thresholds.setThresholds(p.id, [{ metric: "seo", minScore: 90, enabled: true }, { metric: "seo", minScore: 80, enabled: true }], db),
        "INVALID",
        /una vez/,
      );
      await rejectsWith(thresholds.setThresholds("11111111-1111-4111-8111-111111111111", [{ metric: "seo", minScore: 90, enabled: true }], db), "NOT_FOUND");
    });
  });

  describe("rutas", () => {
    const setup = async () => {
      const c = await newClient("Acme");
      return projects.createProject(c.id, { name: "Web", baseUrl: "https://acme.test" }, db);
    };

    it("agrega rutas normalizadas, monitoreadas y sin duplicados", async () => {
      const p = await setup();
      const r = await routes.addRoute(p.id, { path: "contacto/?utm=1", label: "Contacto" }, db);
      expect(r).toMatchObject({ path: "/contacto", url: "https://acme.test/contacto", monitored: true, source: "manual", label: "Contacto" });
      await rejectsWith(routes.addRoute(p.id, { path: "/contacto" }, db), "CONFLICT", /ya existe/);
      await rejectsWith(routes.addRoute(p.id, { path: "/con espacio" }, db), "INVALID");
      expect((await routes.listRoutes(p.id, db)).map((x) => x.path)).toEqual(["/contacto"]);
    });

    it("acepta una URL completa solo si su host está permitido", async () => {
      const p = await setup();
      expect((await routes.addRoute(p.id, { path: "https://acme.test/precios" }, db)).path).toBe("/precios");
      await rejectsWith(routes.addRoute(p.id, { path: "https://otro.test/x" }, db), "FORBIDDEN_HOST");
      await rejectsWith(routes.addRoute(p.id, { path: "http://169.254.169.254/latest" }, db), "FORBIDDEN_HOST");
    });

    it("activa/desactiva, y no borra rutas con historial", async () => {
      const p = await setup();
      const r = await routes.addRoute(p.id, { path: "/" }, db);
      expect((await routes.setRouteMonitored(r.id, false, db)).monitored).toBe(false);
      await db.insert(s.auditLogs).values({ projectId: p.id, routeId: r.id, profile: "mobile", trigger: "manual", phaseAtRun: "development", status: "succeeded" });
      await rejectsWith(routes.removeRoute(r.id, db), "CONFLICT", /historial/);
      const empty = await routes.addRoute(p.id, { path: "/vacia" }, db);
      await routes.removeRoute(empty.id, db);
      expect((await routes.listRoutes(p.id, db)).map((x) => x.path)).toEqual(["/"]);
      await rejectsWith(routes.setRouteMonitored("11111111-1111-4111-8111-111111111111", true, db), "NOT_FOUND");
    });
  });

  describe("descubrimiento por sitemap", () => {
    let server: Server;
    let origin: string;
    const urlset = (...locs: string[]) =>
      `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map((l) => `<url><loc>${l}</loc></url>`).join("")}</urlset>`;

    beforeAll(async () => {
      server = createServer((req, res) => {
        const path = req.url ?? "/";
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const xml = (body: string) => void res.writeHead(200, { "content-type": "application/xml" }).end(body);
        if (path === "/sitemap.xml") {
          return xml(urlset(`${base}/`, `${base}/blog/`, `${base}/blog`, `${base}/precios?plan=pro`, `${base}/contacto#form`, `<![CDATA[${base}/a&amp;b]]>`, "https://otro.test/ajeno", "no-es-url"));
        }
        if (path === "/index/sitemap.xml") {
          return xml(`<sitemapindex><sitemap><loc>${base}/hijo-1.xml</loc></sitemap><sitemap><loc>${base}/hijo-roto.xml</loc></sitemap><sitemap><loc>https://otro.test/h.xml</loc></sitemap></sitemapindex>`);
        }
        if (path === "/hijo-1.xml") return xml(urlset(`${base}/uno`, `${base}/dos`));
        if (path === "/html/sitemap.xml") return void res.writeHead(200, { "content-type": "text/html" }).end("<html><body>no soy un sitemap</body></html>");
        res.writeHead(404).end("no");
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterAll(() => {
      server.closeAllConnections();
      server.close();
    });

    const setupProject = async (sitemapUrl?: string) => {
      const c = await newClient("Acme");
      return projects.createProject(c.id, { name: "Local", baseUrl: origin, sitemapUrl }, db);
    };
    const opts = { allowPrivate: true };

    it("lista candidatas normalizadas, sin duplicados ni hosts ajenos, y marca las ya agregadas", async () => {
      const p = await setupProject();
      await routes.addRoute(p.id, { path: "/blog" }, db);
      const r = await discoverRoutes(p.id, db, opts);
      expect(r.sitemapUrl).toBe(`${origin}/sitemap.xml`);
      expect(r.candidates.map((c) => c.path).sort()).toEqual(["/", "/a&b", "/contacto", "/precios"]);
      expect(r).toMatchObject({ alreadyAdded: 1, otherHosts: 1, truncated: false });
      expect(r.candidates.find((c) => c.path === "/precios")?.url).toBe(`${origin}/precios`);
      const [row] = await db.select().from(s.projects);
      expect(row?.lastSitemapScanAt).toBeInstanceOf(Date);
    });

    it("sigue un índice de sitemaps e ignora hijos rotos o de otro host", async () => {
      const p = await setupProject(`${origin}/index/sitemap.xml`);
      const r = await discoverRoutes(p.id, db, opts);
      expect(r.candidates.map((c) => c.path).sort()).toEqual(["/dos", "/uno"]);
    });

    it("explica los fallos: 404 y respuesta que no es sitemap", async () => {
      const missing = await setupProject(`${origin}/no-existe.xml`);
      await rejectsWith(discoverRoutes(missing.id, db, opts), "UPSTREAM", /No se encontró el sitemap/);
      const html = await setupProject(`${origin}/html/sitemap.xml`);
      await rejectsWith(discoverRoutes(html.id, db, opts), "UPSTREAM", /no parece un sitemap/);
    });

    it("sin la opción de pruebas, no conecta a una dirección privada", async () => {
      const p = await setupProject();
      await rejectsWith(discoverRoutes(p.id, db), "FORBIDDEN_HOST");
    });

    it("importa solo las elegidas, las deja monitoreadas y no duplica", async () => {
      const p = await setupProject();
      await routes.addRoute(p.id, { path: "/contacto" }, db);
      const r = await importRoutes(p.id, ["/", "/precios/", "contacto"], db);
      expect(r).toEqual({ added: 2, skipped: 1 });
      const all = await routes.listRoutes(p.id, db);
      expect(all.find((x) => x.path === "/precios")).toMatchObject({ source: "sitemap", monitored: true });
      await rejectsWith(importRoutes(p.id, [], db), "INVALID", /al menos una/);
    });
  });
});
