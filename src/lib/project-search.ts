export type SwitcherItem = { id: string; name: string; clientName: string; href: string; phase: "development" | "production" };

/** Minúsculas y sin acentos, para que "cafe" encuentre "Café". */
export const normalize = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/**
 * Filtra por nombre del proyecto o del cliente: cada palabra de la búsqueda debe aparecer en alguno de los dos.
 * Los que empiezan por la búsqueda van primero. Sin búsqueda se devuelven todos en su orden.
 */
export function filterProjectItems(items: SwitcherItem[], query: string): SwitcherItem[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return items;
  const scored = items.flatMap((item, index) => {
    const name = normalize(item.name);
    const hay = `${name} ${normalize(item.clientName)}`;
    if (!words.every((w) => hay.includes(w))) return [];
    return [{ item, index, rank: name.startsWith(words[0]!) ? 0 : 1 }];
  });
  return scored.sort((a, b) => a.rank - b.rank || a.index - b.index).map((s) => s.item);
}
