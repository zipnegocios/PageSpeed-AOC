/**
 * Restaura un respaldo de Postgres desde R2 (o desde un archivo).
 *
 *   node restore-cli.cjs --list                 lista los respaldos de R2
 *   node restore-cli.cjs latest --dry-run       valida el último sin tocar la base
 *   node restore-cli.cjs latest                 restaura el último en una base vacía
 *   node restore-cli.cjs <clave-en-R2>          restaura uno concreto
 *   node restore-cli.cjs --file ./respaldo.ndjson.gz
 *
 * Variables: DATABASE_URL y R2_* (las del servicio web).
 */
import { readFile } from "node:fs/promises";
import { createDb } from "@/server/db/client";
import { createR2, r2ConfigFromEnv } from "@/server/storage/r2";
import { BACKUP_PREFIX, isBackupKey } from "./retention";
import { parseBackup, restoreBackup, RestoreError } from "./restore";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const fileIdx = args.indexOf("--file");
  const target = args.find((a) => !a.startsWith("--") && a !== args[fileIdx + 1]) ?? (args.includes("--list") ? "--list" : undefined);

  if (!target && fileIdx === -1) {
    console.error("Uso: node restore-cli.cjs --list | latest [--dry-run] | <clave-en-R2> [--dry-run] | --file <archivo>");
    process.exit(2);
  }

  const r2 = fileIdx === -1 ? createR2(r2ConfigFromEnv()) : undefined;
  try {
    if (target === "--list") {
      const items = (await r2!.listObjects(BACKUP_PREFIX)).filter((o) => isBackupKey(o.key)).sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
      if (items.length === 0) console.log("No hay respaldos en R2.");
      for (const o of items) console.log(`${o.lastModified.toISOString()}  ${(o.size / 1024).toFixed(0).padStart(7)} KB  ${o.key}`);
      return;
    }

    let gz: Buffer;
    let label: string;
    if (fileIdx !== -1) {
      label = args[fileIdx + 1] ?? "";
      gz = await readFile(label);
    } else if (target === "latest") {
      const items = (await r2!.listObjects(BACKUP_PREFIX)).filter((o) => isBackupKey(o.key)).sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
      if (!items[0]) throw new RestoreError("No hay respaldos en R2.");
      label = items[0].key;
      gz = await r2!.getObject(label);
    } else {
      label = target!;
      gz = await r2!.getObject(label);
    }

    const parsed = await parseBackup(gz);
    const total = Object.values(parsed.footer.counts).reduce((a, b) => a + b, 0);
    console.log(`Respaldo ${label}\n  creado: ${parsed.header.createdAt}\n  filas: ${total}`);
    for (const [t, n] of Object.entries(parsed.footer.counts)) console.log(`  ${t}: ${n}`);
    if (dryRun) {
      console.log("Respaldo válido (--dry-run: no se tocó la base).");
      return;
    }

    const url = process.env.DATABASE_URL;
    if (!url) throw new RestoreError("Falta DATABASE_URL.");
    const { db, pool } = createDb(url, 1);
    try {
      const done = await restoreBackup(db, gz);
      console.log(`Restauración completa: ${done.rows} filas.`);
    } finally {
      await pool.end();
    }
  } finally {
    r2?.destroy();
  }
}

main().catch((err) => {
  console.error(err instanceof RestoreError ? `Error: ${err.message}` : err);
  process.exit(1);
});
