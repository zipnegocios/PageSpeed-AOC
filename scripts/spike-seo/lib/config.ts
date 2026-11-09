import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseMarkets, type Market } from "./lang";

export type SpikeConfig = {
  /** Carpeta de salida. Por defecto `.spike/` (ignorada por git). Nunca subas su contenido. */
  outDir: string;
  days: number;
  lagDays: number;
  siteUrl?: string;
  keyFile?: string;
  gscSite?: string;
  gscDataState: "final" | "all";
  ga4Property?: string;
  cfToken?: string;
  cfZone?: string;
  markets: Market[];
  defaultLang?: string;
};

/** Carga `.env.spike` (o `SPIKE_ENV_FILE`) si existe. Lo ya definido en el entorno manda. */
export function loadSpikeEnv(env: NodeJS.ProcessEnv = process.env): void {
  const file = env.SPIKE_ENV_FILE ?? ".env.spike";
  if (existsSync(file)) process.loadEnvFile(file);
}

function num(value: string | undefined, fallback: number, min: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= min ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SpikeConfig {
  return {
    outDir: resolve(env.SPIKE_OUT_DIR ?? ".spike"),
    days: num(env.SPIKE_DAYS, 28, 1),
    lagDays: num(env.SPIKE_LAG_DAYS, 3, 0),
    siteUrl: env.SPIKE_SITE_URL || undefined,
    keyFile: env.SPIKE_GSC_KEY_FILE || undefined,
    gscSite: env.SPIKE_GSC_SITE || undefined,
    gscDataState: env.SPIKE_GSC_DATA_STATE === "all" ? "all" : "final",
    ga4Property: env.SPIKE_GA4_PROPERTY || undefined,
    cfToken: env.SPIKE_CF_TOKEN || undefined,
    cfZone: env.SPIKE_CF_ZONE || undefined,
    markets: parseMarkets(env.SPIKE_LANGS ?? ""),
    defaultLang: env.SPIKE_LANG_DEFAULT || undefined,
  };
}

/** Exige un valor de configuración con un mensaje claro. */
export function need<T>(name: string, value: T | undefined): T {
  if (value === undefined || value === null || value === "") throw new Error(`Falta ${name}. Defínelo en .env.spike (ver scripts/spike-seo/env.spike.example).`);
  return value;
}
