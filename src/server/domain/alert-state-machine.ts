/**
 * Máquina de estados de las alertas. Pura: recibe hechos y devuelve la acción; no toca la base de
 * datos ni envía nada. Una alerta es una condición (ruta + perfil + métrica, o fallo de auditoría)
 * que se abre una vez, no se repite mientras siga igual y se cierra al recuperarse. Una nueva caída
 * después de recuperarse es una alerta nueva.
 */

export type StateAction = "none" | "open" | "keep" | "resolve";

/** Resultado de una auditoría correcta frente al umbral de una métrica. */
export function decideThreshold(input: {
  /** Puntuación 0-100, o null si Lighthouse no la calculó. */
  score: number | null;
  minScore: number;
  enabled: boolean;
  hasOpen: boolean;
}): StateAction {
  const { score, minScore, enabled, hasOpen } = input;
  // Un umbral desactivado deja de vigilar: si había alerta abierta, se cierra.
  if (!enabled) return hasOpen ? "resolve" : "none";
  // Sin dato no se puede afirmar ni caída ni recuperación.
  if (score === null) return hasOpen ? "keep" : "none";
  if (score < minScore) return hasOpen ? "keep" : "open";
  return hasOpen ? "resolve" : "none";
}

/** Una auditoría terminó con éxito: cualquier fallo abierto de esa ruta y perfil queda resuelto. */
export function decideFailureOnSuccess(hasOpen: boolean): StateAction {
  return hasOpen ? "resolve" : "none";
}

/** Una auditoría agotó sus reintentos. */
export function decideFailureOnFailure(hasOpen: boolean): StateAction {
  return hasOpen ? "keep" : "open";
}

export const REMINDER_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export type NotifyKind = "new" | "reminder";

/**
 * Qué toca avisar de una alerta abierta: "new" si nunca se avisó, "reminder" si pasó el intervalo
 * desde el último aviso, null si todavía no toca.
 */
export function notifyKind(
  state: { lastNotifiedAt: Date | null },
  now: Date,
  intervalMs = REMINDER_INTERVAL_MS,
): NotifyKind | null {
  if (state.lastNotifiedAt === null) return "new";
  return now.getTime() - state.lastNotifiedAt.getTime() >= intervalMs ? "reminder" : null;
}
