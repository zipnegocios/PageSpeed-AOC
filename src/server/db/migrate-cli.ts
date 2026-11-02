// Punto de entrada que corre antes de levantar el web: `node migrate-cli.cjs && node server.js`.
// Solo necesita DATABASE_URL; no valida el resto del entorno.
import { Client } from "pg";
import { runMigrations } from "./migrate";

const ATTEMPTS = Number(process.env.MIGRATE_CONNECT_ATTEMPTS ?? 10);
const DELAY_MS = Number(process.env.MIGRATE_CONNECT_DELAY_MS ?? 3000);

/** host:puerto/base, sin usuario ni contraseña: seguro para mostrar en logs. */
function describeTarget(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || "5432"}${u.pathname}`;
  } catch {
    return "(DATABASE_URL con formato inválido)";
  }
}

async function waitForDb(url: string): Promise<void> {
  const target = describeTarget(url);
  let lastError = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const client = new Client({ connectionString: url, connectionTimeoutMillis: 5000 });
    try {
      await client.connect();
      await client.query("select 1");
      await client.end();
      return;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      await client.end().catch(() => undefined);
      console.error(`[migrate] intento ${attempt}/${ATTEMPTS}: no se pudo conectar a ${target} (${lastError})`);
      if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }
  throw new Error(`Postgres no responde en ${target}. Revisa el host y la contraseña de DATABASE_URL.`);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[migrate] DATABASE_URL no está definida");
    process.exit(1);
  }
  const folder = process.env.MIGRATIONS_DIR ?? "./drizzle";
  const started = Date.now();
  await waitForDb(url);
  await runMigrations(url, folder);
  console.log(`[migrate] migraciones al día en ${describeTarget(url)} (${Date.now() - started} ms)`);
}

main().catch((err) => {
  console.error("[migrate] fallo:", err instanceof Error ? err.message : err);
  process.exit(1);
});
