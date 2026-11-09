import { loadSpikeEnv } from "./config";
import { SpikeHttpError } from "./http";

/** Valor de un argumento `--nombre valor`, o undefined. */
export function arg(name: string, argv: string[] = process.argv): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** Punto de entrada común: carga `.env.spike`, ejecuta y convierte los errores en un mensaje legible (sin credenciales). */
export async function run(main: () => Promise<void>): Promise<void> {
  try {
    loadSpikeEnv();
    await main();
  } catch (err) {
    if (err instanceof SpikeHttpError) console.error(`[${err.code}] ${err.message}`);
    else console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

export const log = (message: string): void => console.log(message);

/** Imprime una tabla sencilla de objetos. */
export function table(rows: Array<Record<string, string | number>>): void {
  if (rows.length === 0) return log("  (sin filas)");
  console.table(rows);
}
