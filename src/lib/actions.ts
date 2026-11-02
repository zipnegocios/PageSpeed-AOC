import { unstable_rethrow } from "next/navigation";
import { isDomainError } from "@/server/domain/errors";

export type SitemapCandidate = { path: string; url: string };

/** Resultado que las acciones devuelven a su formulario. */
export type ActionState = {
  error?: string;
  ok?: string;
  /** Rutas halladas en el sitemap, pendientes de elegir. */
  candidates?: SitemapCandidate[];
};

/**
 * Envuelve una acción: los errores de negocio se devuelven como mensaje al formulario y los
 * inesperados se registran. Las redirecciones de Next se vuelven a lanzar.
 */
export async function guarded(fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try {
    return (await fn()) ?? {};
  } catch (err) {
    unstable_rethrow(err);
    if (isDomainError(err)) return { error: err.message };
    console.error("[acción]", err);
    return { error: "Ocurrió un error inesperado. Inténtalo de nuevo." };
  }
}

/** FormData -> texto ("" si falta el campo). */
export function field(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "");
}
