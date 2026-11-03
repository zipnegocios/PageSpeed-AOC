import { promisify } from "node:util";
import { gzip } from "node:zlib";
import type { Database } from "@/server/db/client";
import { BACKUP_FORMAT, BACKUP_TABLES, encodeRow, type BackupFooter, type BackupHeader } from "./format";
import { backupKey } from "./retention";

const gzipAsync = promisify(gzip);
const PAGE = 2000;
/** Tope de seguridad: el respaldo se arma en memoria. Pasado esto hay que pasar a un volcado por flujo. */
const MAX_RAW_BYTES = 400 * 1024 * 1024;

export type BackupResult = { key: string; bytes: number; rawBytes: number; counts: Record<string, number>; rows: number };

/**
 * Exporta toda la base como NDJSON comprimido: una cabecera, una línea por fila ({"t": tabla, "r": fila}) y
 * un pie con los totales. Lee en una transacción de solo lectura con snapshot, así que el respaldo es
 * coherente aunque el sistema siga escribiendo. No depende de `pg_dump` ni de su versión.
 */
export async function buildBackup(db: Database, now: Date): Promise<{ body: Buffer; key: string; counts: Record<string, number>; rawBytes: number }> {
  const lines: string[] = [];
  let rawBytes = 0;
  const push = (line: string) => {
    rawBytes += line.length + 1;
    if (rawBytes > MAX_RAW_BYTES) throw new Error("El respaldo supera el tamaño máximo en memoria.");
    lines.push(line);
  };
  const header: BackupHeader = { _: "aoc-backup", format: BACKUP_FORMAT, createdAt: now.toISOString(), tables: BACKUP_TABLES.map((t) => t.name) };
  push(JSON.stringify(header));

  const counts: Record<string, number> = {};
  await db.transaction(
    async (tx) => {
      for (const { name, table, order } of BACKUP_TABLES) {
        counts[name] = 0;
        for (let offset = 0; ; offset += PAGE) {
          const rows = await tx.select().from(table).orderBy(...order).limit(PAGE).offset(offset);
          for (const row of rows) {
            push(`{"t":"${name}","r":${encodeRow(row)}}`);
            counts[name]!++;
          }
          if (rows.length < PAGE) break;
        }
      }
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  const footer: BackupFooter = { _: "end", counts };
  push(JSON.stringify(footer));
  return { body: await gzipAsync(Buffer.from(lines.join("\n"), "utf8")), key: backupKey(now), counts, rawBytes };
}
