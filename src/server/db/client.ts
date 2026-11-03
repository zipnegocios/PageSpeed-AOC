import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

export function createDb(connectionString: string, max = 5): { db: Database; pool: Pool } {
  // Sin tiempo máximo de conexión, pg espera para siempre si la base no responde y el arranque
  // se queda mudo. Con él, el fallo aparece en los logs a los 10 s.
  const pool = new Pool({ connectionString, max, connectionTimeoutMillis: 10_000 });
  return { db: drizzle(pool, { schema }), pool };
}

// En desarrollo Next recarga módulos; el singleton evita abrir pools sin límite.
const globalForDb = globalThis as unknown as { __aocDb?: { db: Database; pool: Pool } };

/** Base de datos compartida del proceso (web o worker). */
export function getDb(): Database {
  if (!globalForDb.__aocDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL no está definida");
    globalForDb.__aocDb = createDb(url);
  }
  return globalForDb.__aocDb.db;
}

export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
