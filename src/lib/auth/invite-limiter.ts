import { AttemptLimiter } from "@/server/auth/rate-limit";

// Un singleton por proceso; sobrevive a las recargas de módulos en desarrollo.
const g = globalThis as unknown as { __pagespeedInviteLimiter?: AttemptLimiter };

/** Enlaces de invitación inválidos o contraseñas rechazadas por IP: 20 en 10 minutos. Frena el barrido de tokens. */
export const inviteLimiter = (g.__pagespeedInviteLimiter ??= new AttemptLimiter({ max: 20, windowMs: 10 * 60 * 1000 }));
