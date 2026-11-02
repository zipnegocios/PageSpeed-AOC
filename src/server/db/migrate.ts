import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

/** Aplica las migraciones pendientes. Idempotente: volver a correrlo no hace nada. */
export async function runMigrations(connectionString: string, migrationsFolder: string) {
  const pool = new Pool({ connectionString, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}
