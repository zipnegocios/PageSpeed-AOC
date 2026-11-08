import { Redis } from "ioredis";

// Nombre histórico del espacio de claves en Redis: se conserva para no abandonar los trabajos ya encolados al renombrar el producto.
export const QUEUE_PREFIX = "aoc";

/** Conexión para BullMQ: exige maxRetriesPerRequest = null. */
export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}

// Un solo cliente por proceso (en desarrollo Next recarga módulos).
const g = globalThis as unknown as { __pagespeedRedis?: Redis };

export function getRedis(): Redis {
  if (!g.__pagespeedRedis) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL no está definida");
    const redis = createRedis(url);
    redis.on("error", () => undefined); // los errores llegan a quien hace la llamada
    g.__pagespeedRedis = redis;
  }
  return g.__pagespeedRedis;
}
