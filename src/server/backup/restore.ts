import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { sql } from "drizzle-orm";
import type { Database } from "@/server/db/client";
import { BACKUP_FORMAT, BACKUP_TABLES, decodeRow, type BackupFooter, type BackupHeader } from "./format";

const gunzipAsync = promisify(gunzip);
const BATCH = 500;

export class RestoreError extends Error {}

export type RestoreResult = { counts: Record<string, number>; rows: number; createdAt: string };

/** Lee y valida un respaldo sin tocar la base: cabecera, formato, pie con totales y que no esté truncado. */
export async function parseBackup(gz: Buffer): Promise<{ header: BackupHeader; rows: Map<string, Record<string, unknown>[]>; footer: BackupFooter }> {
  let text: string;
  try {
    text = (await gunzipAsync(gz)).toString("utf8");
  } catch {
    throw new RestoreError("El archivo no es un respaldo válido (no se pudo descomprimir).");
  }
  const lines = text.split("\n").filter(Boolean);
  const header = decodeRow<BackupHeader>(lines[0] ?? "{}");
  if (header._ !== "aoc-backup") throw new RestoreError("El archivo no es un respaldo de AOC PageSpeed.");
  if (header.format !== BACKUP_FORMAT) throw new RestoreError(`Formato de respaldo ${header.format} no soportado (se esperaba ${BACKUP_FORMAT}).`);
  const footer = decodeRow<BackupFooter>(lines.at(-1) ?? "{}");
  if (footer._ !== "end") throw new RestoreError("El respaldo está incompleto (falta el pie con los totales).");

  const known = new Set(BACKUP_TABLES.map((t) => t.name));
  const rows = new Map<string, Record<string, unknown>[]>(BACKUP_TABLES.map((t) => [t.name, []]));
  for (const line of lines.slice(1, -1)) {
    const { t, r } = decodeRow<{ t: string; r: Record<string, unknown> }>(line);
    if (!known.has(t)) throw new RestoreError(`El respaldo trae una tabla desconocida: ${t}.`);
    rows.get(t)!.push(r);
  }
  for (const { name } of BACKUP_TABLES) {
    if ((rows.get(name)?.length ?? 0) !== (footer.counts[name] ?? 0)) {
      throw new RestoreError(`El respaldo está dañado: ${name} tiene ${rows.get(name)?.length ?? 0} filas y el pie dice ${footer.counts[name] ?? 0}.`);
    }
  }
  return { header, rows, footer };
}

/**
 * Restaura un respaldo en una base con el esquema ya migrado. Exige que no haya clientes, proyectos ni
 * auditorías (para no mezclar datos); `admin_users` y `settings` se reemplazan porque el respaldo manda
 * (el primer arranque pudo crear un administrador). Todo ocurre en una transacción: o entra completo o no entra.
 */
export async function restoreBackup(db: Database, gz: Buffer): Promise<RestoreResult> {
  const { header, rows, footer } = await parseBackup(gz);
  await db.transaction(async (tx) => {
    for (const name of ["clients", "projects", "audit_logs"] as const) {
      const [r] = (await tx.execute(sql.raw(`select count(*)::int as n from ${name}`))).rows as Array<{ n: number }>;
      if ((r?.n ?? 0) > 0) throw new RestoreError(`La base de destino no está vacía (${name} tiene datos). Restaura sobre una base nueva con las migraciones aplicadas.`);
    }
    await tx.execute(sql.raw("delete from admin_users"));
    await tx.execute(sql.raw("delete from settings"));
    for (const { name, table } of BACKUP_TABLES) {
      const list = rows.get(name) ?? [];
      for (let i = 0; i < list.length; i += BATCH) {
        await tx.insert(table).values(list.slice(i, i + BATCH) as never);
      }
    }
  });
  const total = Object.values(footer.counts).reduce((a, b) => a + b, 0);
  return { counts: footer.counts, rows: total, createdAt: header.createdAt };
}
