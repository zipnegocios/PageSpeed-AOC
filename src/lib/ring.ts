/** Radio del anillo en un lienzo de 100 x 100. */
export const RING_RADIUS = 42;
const CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
/** El anillo es un arco de 270 grados (3/4 de vuelta), abierto por abajo. */
export const RING_ARC = CIRCUMFERENCE * 0.75;

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Longitudes de trazo del fondo y del valor de un anillo para una puntuación de 0 a 100 (fuera de rango se recorta). */
export function ringDashes(value: number): { track: string; arc: string; circumference: number } {
  const v = Math.min(Math.max(value, 0), 100);
  return {
    track: `${r2(RING_ARC)} ${r2(CIRCUMFERENCE)}`,
    arc: `${r2((RING_ARC * v) / 100)} ${r2(CIRCUMFERENCE)}`,
    circumference: r2(CIRCUMFERENCE),
  };
}
