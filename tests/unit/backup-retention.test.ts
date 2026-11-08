import { describe, expect, it } from "vitest";
import { decodeRow, encodeRow } from "@/server/backup/format";
import { BACKUP_PREFIX, backupKey, isBackupKey, selectBackupsToPrune } from "@/server/backup/retention";

const DAY = 86_400_000;
const NOW = new Date("2026-11-03T12:00:00Z");
const obj = (daysAgo: number, name = `pagespeed-${daysAgo}`) => ({
  key: `${BACKUP_PREFIX}2026/10/${name}.ndjson.gz`,
  size: 1000,
  lastModified: new Date(NOW.getTime() - daysAgo * DAY),
});

describe("claves de respaldo", () => {
  it("llevan el prefijo propio, la fecha UTC y no chocan con claves de auditorías", () => {
    expect(backupKey(new Date("2026-11-03T03:17:09Z"))).toBe("_backups/postgres/2026/11/pagespeed-20261103T031709Z.ndjson.gz");
    expect(isBackupKey(backupKey(NOW))).toBe(true);
    expect(isBackupKey("acme/tienda/2026/11/x.json.gz")).toBe(false);
    expect(isBackupKey(`${BACKUP_PREFIX}notas.txt`)).toBe(false);
  });
});

describe("selectBackupsToPrune", () => {
  it("borra lo viejo (más de 30 días) y conserva lo reciente", () => {
    const items = [...Array.from({ length: 10 }, (_, i) => obj(i)), obj(31), obj(45), obj(90)];
    const prune = selectBackupsToPrune(items, NOW);
    expect(prune.sort()).toEqual([obj(31).key, obj(45).key, obj(90).key].sort());
  });

  it("nunca borra los 5 más recientes aunque sean viejos (si los respaldos dejaron de hacerse)", () => {
    const items = [40, 50, 60, 70, 80, 90, 100].map((d) => obj(d));
    const prune = selectBackupsToPrune(items, NOW);
    expect(prune).toHaveLength(2);
    expect(prune).toEqual(expect.arrayContaining([obj(90).key, obj(100).key]));
  });

  it("respeta los umbrales indicados e ignora lo que no es un respaldo", () => {
    const stray = { key: `${BACKUP_PREFIX}README.txt`, size: 1, lastModified: new Date(NOW.getTime() - 999 * DAY) };
    expect(selectBackupsToPrune([stray, obj(10), obj(11)], NOW, { keepDays: 5, keepMin: 1 })).toEqual([obj(11).key]);
    expect(selectBackupsToPrune([], NOW)).toEqual([]);
  });
});

describe("filas del respaldo", () => {
  it("recuperan fechas, binarios, arreglos y JSON tal cual", () => {
    const row = {
      id: "a",
      at: new Date("2026-03-01T10:00:00.123Z"),
      blob: Buffer.from([0, 1, 2, 255]),
      ids: ["x", "y"],
      value: { nested: { n: 1, s: "ñ" }, list: [1, 2] },
      none: null,
      text: 'línea\n"comillas" $d',
    };
    const back = decodeRow<typeof row>(encodeRow(row));
    expect(back.at).toBeInstanceOf(Date);
    expect(back.at.getTime()).toBe(row.at.getTime());
    expect(Buffer.isBuffer(back.blob)).toBe(true);
    expect([...back.blob]).toEqual([0, 1, 2, 255]);
    expect(back).toMatchObject({ id: "a", ids: ["x", "y"], value: row.value, none: null, text: row.text });
  });
  it("una fila nunca ocupa más de una línea", () => {
    expect(encodeRow({ t: "a\nb\r\nc" })).not.toContain("\n");
  });
});
