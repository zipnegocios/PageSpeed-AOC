import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SpikeConfig } from "./config";

/** Escribe un archivo JSON en la carpeta de salida y devuelve su ruta. */
export function writeJson(cfg: Pick<SpikeConfig, "outDir">, name: string, data: unknown): string {
  mkdirSync(cfg.outDir, { recursive: true });
  const path = join(cfg.outDir, `${name}.json`);
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  return path;
}

/** Lee un archivo que dejó otro script; null si no existe. */
export function readJson<T>(cfg: Pick<SpikeConfig, "outDir">, name: string): T | null {
  try {
    return JSON.parse(readFileSync(join(cfg.outDir, `${name}.json`), "utf8")) as T;
  } catch {
    return null;
  }
}
