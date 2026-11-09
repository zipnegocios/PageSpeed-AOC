import type { Recorder } from "../http";
import { mockProvider, type Provider } from "../probe";
import { createAnthropicProvider } from "./anthropic";
import { createGeminiProvider } from "./gemini";
import { createOpenAIProvider } from "./openai";
import { createPerplexityProvider } from "./perplexity";

/** Variable de entorno con la clave de cada proveedor. Sin clave, el proveedor no está disponible. */
export const PROVIDER_KEY_ENV = {
  anthropic: "SPIKE_ANTHROPIC_API_KEY",
  openai: "SPIKE_OPENAI_API_KEY",
  gemini: "SPIKE_GEMINI_API_KEY",
  perplexity: "SPIKE_PERPLEXITY_API_KEY",
} as const;

export type ProviderName = keyof typeof PROVIDER_KEY_ENV;

/**
 * Proveedores de IA con clave configurada, más `mock`. `SPIKE_<PROVEEDOR>_MODEL` cambia el modelo por defecto y
 * `SPIKE_PROBE_COUNTRY` (ISO de dos letras) orienta la ubicación aproximada de la búsqueda donde la API lo admite.
 */
export function availableProviders(env: Record<string, string | undefined> = process.env, deps: { recorder?: Recorder } = {}): Record<string, Provider> {
  const country = env.SPIKE_PROBE_COUNTRY?.trim().toUpperCase() || undefined;
  const common = (name: ProviderName) => ({
    apiKey: env[PROVIDER_KEY_ENV[name]] ?? "",
    model: env[`SPIKE_${name.toUpperCase()}_MODEL`] || undefined,
    location: country ? { country } : undefined,
    recorder: deps.recorder,
  });
  const out: Record<string, Provider> = { mock: mockProvider };
  if (env.SPIKE_ANTHROPIC_API_KEY) out.anthropic = createAnthropicProvider(common("anthropic"));
  if (env.SPIKE_OPENAI_API_KEY) out.openai = createOpenAIProvider(common("openai"));
  if (env.SPIKE_GEMINI_API_KEY) out.gemini = createGeminiProvider(common("gemini"));
  if (env.SPIKE_PERPLEXITY_API_KEY) out.perplexity = createPerplexityProvider(common("perplexity"));
  return out;
}
