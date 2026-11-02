import { AttemptLimiter } from "@/server/auth/rate-limit";

const FIFTEEN_MINUTES = 15 * 60 * 1000;

// Un singleton por proceso; sobrevive a las recargas de módulos en desarrollo.
const g = globalThis as unknown as {
  __aocLoginLimiters?: { perAccount: AttemptLimiter; perIp: AttemptLimiter };
};

export const loginLimiters = (g.__aocLoginLimiters ??= {
  // 5 fallos por IP + correo, y 20 por IP, en 15 minutos.
  perAccount: new AttemptLimiter({ max: 5, windowMs: FIFTEEN_MINUTES }),
  perIp: new AttemptLimiter({ max: 20, windowMs: FIFTEEN_MINUTES }),
});
