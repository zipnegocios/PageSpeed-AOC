export type SparkPoint = { x: number; y: number };

export type SparkLayout = {
  points: SparkPoint[];
  /** Trazo de la línea ("M x y L x y ..."). */
  line: string;
  /** Contorno cerrado hasta la base, para el lavado de color bajo la línea. */
  area: string;
  last: SparkPoint;
  min: number;
  max: number;
};

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Coloca una serie de puntuaciones (0-100) en un rectángulo. La escala se ajusta a los datos, pero nunca se
 * amplía una variación pequeña hasta parecer dramática: el rango visible es de al menos 10 puntos.
 * Con menos de 2 valores no hay línea que dibujar (null).
 */
export function sparklineLayout(values: number[], width: number, height: number, pad = 5): SparkLayout | null {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mid = (min + max) / 2;
  const span = Math.max(max - min, 10);
  const lo = Math.max(0, Math.min(mid - span / 2, 100 - span));
  const hi = lo + span;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const points = values.map((v, i) => ({
    x: r1(pad + (innerW * i) / (values.length - 1)),
    y: r1(pad + innerH - ((Math.min(Math.max(v, lo), hi) - lo) / (hi - lo)) * innerH),
  }));
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
  const last = points[points.length - 1]!;
  const area = `${line} L${last.x} ${height - pad} L${points[0]!.x} ${height - pad} Z`;
  return { points, line, area, last, min, max };
}
