import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import * as s from "@/server/db/schema";

// Requiere un Postgres real: TEST_DATABASE_URL=postgres://USUARIO:CLAVE@127.0.0.1:54329/BASE_test
const url = process.env.TEST_DATABASE_URL;

async function pgCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    return e.cause?.code ?? e.code;
  }
  return undefined;
}

describe.skipIf(!url)("esquema de Postgres", () => {
  const { db, pool } = createDb(url ?? "", 2);

  beforeAll(async () => {
    await runMigrations(url!, "./drizzle");
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await db.execute(sql`truncate clients, admin_users, settings, mcp_api_keys restart identity cascade`);
  });

  async function seed() {
    const [client] = await db
      .insert(s.clients)
      .values({ name: "Acme", slug: "acme", magicToken: `tok-${Math.random()}` })
      .returning();
    const [project] = await db
      .insert(s.projects)
      .values({ clientId: client!.id, name: "Web", slug: "web", baseUrl: "https://acme.test" })
      .returning();
    const [route] = await db
      .insert(s.routes)
      .values({ projectId: project!.id, path: "/", url: "https://acme.test/" })
      .returning();
    return { client: client!, project: project!, route: route! };
  }

  it("crea las tablas esperadas", async () => {
    const r = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`,
    );
    expect(r.rows.map((x) => x.table_name)).toEqual([
      "admin_users",
      "alert_states",
      "alert_thresholds",
      "audit_logs",
      "clients",
      "field_data",
      "mcp_api_keys",
      "notifications",
      "projects",
      "routes",
      "settings",
    ]);
  });

  it("el slug del cliente es único y el del proyecto es único dentro del cliente", async () => {
    const { client } = await seed();
    expect(
      await pgCode(
        db.insert(s.clients).values({ name: "Otro", slug: "acme", magicToken: "t2" }),
      ),
    ).toBe("23505");
    expect(
      await pgCode(
        db
          .insert(s.projects)
          .values({ clientId: client.id, name: "Dup", slug: "web", baseUrl: "https://x.test" }),
      ),
    ).toBe("23505");
    const [other] = await db
      .insert(s.clients)
      .values({ name: "Otro", slug: "otro", magicToken: "t3" })
      .returning();
    await db
      .insert(s.projects)
      .values({ clientId: other!.id, name: "Web", slug: "web", baseUrl: "https://x.test" });
  });

  it("solo permite una auditoría pendiente por ruta y perfil", async () => {
    const { project, route } = await seed();
    const base = {
      projectId: project.id,
      routeId: route.id,
      profile: "mobile" as const,
      trigger: "manual" as const,
      phaseAtRun: "development" as const,
    };
    const [first] = await db.insert(s.auditLogs).values(base).returning();
    expect(await pgCode(db.insert(s.auditLogs).values(base))).toBe("23505");
    // Otro perfil sí.
    await db.insert(s.auditLogs).values({ ...base, profile: "desktop" });
    // Terminada la primera, se puede encolar otra.
    await db.update(s.auditLogs).set({ status: "succeeded" }).where(sql`id = ${first!.id}`);
    await db.insert(s.auditLogs).values(base);
  });

  it("rechaza puntuaciones fuera de 0-100", async () => {
    const { project, route } = await seed();
    const code = await pgCode(
      db.insert(s.auditLogs).values({
        projectId: project.id,
        routeId: route.id,
        profile: "mobile",
        trigger: "manual",
        phaseAtRun: "production",
        scorePerformance: 101,
      }),
    );
    expect(code).toBe("23514");
  });

  it("mantiene un único estado de alerta abierto por condición", async () => {
    const { project, route } = await seed();
    const threshold = {
      projectId: project.id,
      routeId: route.id,
      profile: "mobile" as const,
      kind: "threshold" as const,
      metric: "performance" as const,
    };
    const [open] = await db.insert(s.alertStates).values(threshold).returning();
    expect(await pgCode(db.insert(s.alertStates).values(threshold))).toBe("23505");
    // Otra métrica sí.
    await db.insert(s.alertStates).values({ ...threshold, metric: "seo" });
    // Resuelta, una recaída es un evento nuevo.
    await db
      .update(s.alertStates)
      .set({ status: "resolved" })
      .where(sql`id = ${open!.id}`);
    await db.insert(s.alertStates).values(threshold);

    const failure = {
      projectId: project.id,
      routeId: route.id,
      profile: "mobile" as const,
      kind: "audit_failure" as const,
    };
    await db.insert(s.alertStates).values(failure);
    expect(await pgCode(db.insert(s.alertStates).values(failure))).toBe("23505");
  });

  it("exige metric en alertas de umbral y la prohíbe en fallos", async () => {
    const { project, route } = await seed();
    const common = { projectId: project.id, routeId: route.id, profile: "desktop" as const };
    expect(
      await pgCode(db.insert(s.alertStates).values({ ...common, kind: "threshold" })),
    ).toBe("23514");
    expect(
      await pgCode(
        db.insert(s.alertStates).values({ ...common, kind: "audit_failure", metric: "seo" }),
      ),
    ).toBe("23514");
  });

  it("valida el rango del umbral y su clave primaria", async () => {
    const { project } = await seed();
    expect(
      await pgCode(
        db.insert(s.alertThresholds).values({ projectId: project.id, metric: "seo", minScore: 120 }),
      ),
    ).toBe("23514");
    await db.insert(s.alertThresholds).values({ projectId: project.id, metric: "seo", minScore: 90 });
    expect(
      await pgCode(
        db.insert(s.alertThresholds).values({ projectId: project.id, metric: "seo", minScore: 80 }),
      ),
    ).toBe("23505");
  });

  it("no deja borrar un cliente con proyectos, pero sí borrar un proyecto en cascada", async () => {
    const { client, project } = await seed();
    expect(await pgCode(db.delete(s.clients).where(sql`id = ${client.id}`))).toBe("23503");
    await db.delete(s.projects).where(sql`id = ${project.id}`);
    const rest = await db.execute<{ n: string }>(sql`select count(*) as n from routes`);
    expect(rest.rows[0]!.n).toBe("0");
  });
});
