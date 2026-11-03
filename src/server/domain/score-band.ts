export type ScoreBand = "ok" | "warning" | "danger";

/** ≥ 90 bueno, 50-89 mejorable, < 50 deficiente (misma regla que el componente Score). */
export function scoreBand(score: number): { tone: ScoreBand; word: "bueno" | "mejorable" | "deficiente" } {
  if (score >= 90) return { tone: "ok", word: "bueno" };
  if (score >= 50) return { tone: "warning", word: "mejorable" };
  return { tone: "danger", word: "deficiente" };
}
