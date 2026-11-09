import { AttemptLimiter } from "@/server/auth/rate-limit";

const g = globalThis as unknown as { __pagespeedOauthLimiters?: { register: AttemptLimiter; token: AttemptLimiter } };

/** Cuentan cada llamada por IP: 10 registros y 60 canjes de token cada 10 minutos. */
export const oauthLimiters = (g.__pagespeedOauthLimiters ??= {
  register: new AttemptLimiter({ max: 10, windowMs: 10 * 60_000 }),
  token: new AttemptLimiter({ max: 60, windowMs: 10 * 60_000 }),
});
