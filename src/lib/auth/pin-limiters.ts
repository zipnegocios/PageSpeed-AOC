import { AttemptLimiter } from "@/server/auth/rate-limit";

// Singletons por proceso; sobreviven a las recargas de módulos en desarrollo.
const g = globalThis as unknown as { __aocPin?: { ipSlug: AttemptLimiter; slug: AttemptLimiter; requests: AttemptLimiter } };
const limiters = (g.__aocPin ??= {
  /** PIN erróneos desde una IP para un cliente: 5 en 15 minutos. */
  ipSlug: new AttemptLimiter({ max: 5, windowMs: 15 * 60_000 }),
  /** PIN erróneos para un cliente desde cualquier IP: 25 en 15 minutos. Hace inviable adivinar 1 000 000 de combinaciones. */
  slug: new AttemptLimiter({ max: 25, windowMs: 15 * 60_000 }),
  /** PIN pedidos por correo desde una IP: 5 por hora. */
  requests: new AttemptLimiter({ max: 5, windowMs: 60 * 60_000 }),
});

export const pinIpSlugLimiter = limiters.ipSlug;
export const pinSlugLimiter = limiters.slug;
export const pinRequestLimiter = limiters.requests;
