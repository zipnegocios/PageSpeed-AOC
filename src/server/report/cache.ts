/**
 * Caché corta y cola de un solo carril para generar PDFs. Renderizar es CPU pura en un servidor
 * compartido: se hace de uno en uno y se reutiliza el resultado unos minutos para que pulsar el
 * botón varias veces (o abrir el mismo informe desde dos sitios) no repita el trabajo.
 */
export function createSerialCache<T>(options: { ttlMs: number; maxEntries?: number; now?: () => number }) {
  const now = options.now ?? Date.now;
  const max = options.maxEntries ?? 20;
  const entries = new Map<string, { at: number; value: T }>();
  const inflight = new Map<string, Promise<T>>();
  let lane: Promise<unknown> = Promise.resolve();

  return {
    get(key: string, produce: () => Promise<T>): Promise<T> {
      const hit = entries.get(key);
      if (hit && now() - hit.at < options.ttlMs) return Promise.resolve(hit.value);
      const pending = inflight.get(key);
      if (pending) return pending;

      const run = lane.then(async () => {
        // Otra petición pudo generarlo mientras esperaba el turno.
        const again = entries.get(key);
        if (again && now() - again.at < options.ttlMs) return again.value;
        const value = await produce();
        entries.set(key, { at: now(), value });
        while (entries.size > max) entries.delete(entries.keys().next().value as string);
        return value;
      });
      const tracked = run.finally(() => inflight.delete(key));
      inflight.set(key, tracked);
      // El carril sigue aunque una generación falle.
      lane = tracked.catch(() => undefined);
      return tracked;
    },
    clear() {
      entries.clear();
    },
  };
}
