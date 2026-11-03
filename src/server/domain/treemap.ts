export type TreemapInput = { name: string; value: number };
export type TreemapRect = { name: string; value: number; x: number; y: number; w: number; h: number };

/**
 * Mapa de rectángulos (squarified treemap) en coordenadas de 0 a 100. Cada elemento ocupa un área proporcional a
 * su valor y los rectángulos se mantienen lo más cuadrados posible. Los valores no positivos se ignoran.
 */
export function squarify(input: TreemapInput[], width = 100, height = 100): TreemapRect[] {
  const items = input.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const total = items.reduce((s, i) => s + i.value, 0);
  if (total === 0) return [];
  const scale = (width * height) / total;
  const areas = items.map((i) => ({ ...i, area: i.value * scale }));
  const out: TreemapRect[] = [];
  let x = 0;
  let y = 0;
  let w = width;
  let h = height;
  let row: typeof areas = [];

  const worst = (r: typeof areas, side: number) => {
    const sum = r.reduce((s, i) => s + i.area, 0);
    const max = Math.max(...r.map((i) => i.area));
    const min = Math.min(...r.map((i) => i.area));
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  };
  const flush = () => {
    if (row.length === 0) return;
    const sum = row.reduce((s, i) => s + i.area, 0);
    if (w >= h) {
      // fila vertical a la izquierda
      const rw = sum / h;
      let cy = y;
      for (const i of row) {
        const rh = i.area / rw;
        out.push({ name: i.name, value: i.value, x, y: cy, w: rw, h: rh });
        cy += rh;
      }
      x += rw;
      w -= rw;
    } else {
      const rh = sum / w;
      let cx = x;
      for (const i of row) {
        const rw = i.area / rh;
        out.push({ name: i.name, value: i.value, x: cx, y, w: rw, h: rh });
        cx += rw;
      }
      y += rh;
      h -= rh;
    }
    row = [];
  };

  for (const item of areas) {
    const side = Math.min(w, h);
    if (row.length === 0 || worst([...row, item], side) <= worst(row, side)) row.push(item);
    else {
      flush();
      row.push(item);
    }
  }
  flush();
  return out;
}
