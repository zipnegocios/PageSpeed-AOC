import { AttemptLimiter } from "@/server/auth/rate-limit";

// Un singleton por proceso; sobrevive a las recargas de módulos en desarrollo.
const g = globalThis as unknown as { __aocPortalLimiter?: AttemptLimiter };

/** Enlaces inválidos por IP: 30 en 10 minutos. Frena el barrido de tokens sin molestar a un typo. */
export const portalLimiter = (g.__aocPortalLimiter ??= new AttemptLimiter({ max: 30, windowMs: 10 * 60 * 1000 }));
