import { z } from "zod";

const int = (def: number) => z.coerce.number().int().positive().default(def);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // URL pública del web; se usa para armar los links mágicos y los enlaces de los emails.
  APP_URL: z.url().default("http://localhost:3000"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  SESSION_SECRET: z.string().min(32),
  // Admin único: se crea en el primer arranque si no existe; después estas variables se ignoran.
  ADMIN_EMAIL: z.email().optional(),
  ADMIN_PASSWORD: z.string().min(12).optional(),
  AUTH_ENCRYPTION_KEY: z
    .string()
    .optional()
    .refine((v) => !v || Buffer.from(v, "base64").length === 32, "must be 32 bytes in base64"),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  R2_ENDPOINT: z.url(),
  R2_REGION: z.string().default("auto"),
  R2_BUCKET: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),

  SMTP_HOST: z.string().min(1),
  SMTP_PORT: int(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().min(1),

  CHROME_PATH: z.string().optional(),
  AUDIT_COOLDOWN_MS: int(12_000),
  AUDIT_TIMEOUT_MS: int(90_000),
  AUDIT_ATTEMPTS: int(3),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  return result.data;
}

/** Nombres de las variables inválidas o ausentes. Nunca incluye valores. */
export function envIssues(source: Record<string, string | undefined>): string[] {
  const result = schema.safeParse(source);
  if (result.success) return [];
  return [...new Set(result.error.issues.map((i) => String(i.path[0] ?? "?")))];
}

// ------------------------------------------------------------ entorno del worker
// El worker no necesita sesión, admin ni correo (el correo entra con las alertas).
const workerSchema = schema.pick({
  NODE_ENV: true,
  LOG_LEVEL: true,
  DATABASE_URL: true,
  REDIS_URL: true,
  R2_ENDPOINT: true,
  R2_REGION: true,
  R2_BUCKET: true,
  R2_ACCESS_KEY_ID: true,
  R2_SECRET_ACCESS_KEY: true,
  CHROME_PATH: true,
  AUDIT_COOLDOWN_MS: true,
  AUDIT_TIMEOUT_MS: true,
  AUDIT_ATTEMPTS: true,
});

export type WorkerEnv = z.infer<typeof workerSchema>;

export function parseWorkerEnv(source: Record<string, string | undefined>): WorkerEnv {
  const result = workerSchema.safeParse(source);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((i) => String(i.path[0] ?? "?")))];
    throw new Error(`Variables de entorno del worker ausentes o inválidas: ${names.join(", ")}`);
  }
  return result.data;
}

let cached: Env | undefined;
/** Validated process.env, parsed once. Never import this from client components. */
export function env(): Env {
  return (cached ??= parseEnv(process.env));
}
