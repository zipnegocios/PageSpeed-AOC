import { sql } from "drizzle-orm";
import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { Redis } from "ioredis";
import { createTransport } from "nodemailer";
import { getDb } from "@/server/db/client";
import { envIssues, parseEnv } from "@/server/config/env";

export type CheckName = "postgres" | "redis" | "r2" | "smtp";
export type CheckResult = { name: CheckName; ok: boolean; ms: number; error?: string };
export type HealthReport = {
  status: "ok" | "degraded";
  checkedAt: string;
  checks: CheckResult[];
  /** Variables de entorno ausentes o inválidas (solo nombres). */
  invalidEnv?: string[];
};

class CheckTimeout extends Error {
  constructor(ms: number) {
    super(`timeout ${ms}ms`);
    this.name = "TIMEOUT";
  }
}

const SAFE_CODE = /^[A-Za-z0-9_.-]{1,40}$/;

/**
 * Convierte un error en un código corto y seguro para mostrar. Nunca devuelve el mensaje
 * original, que podría contener hosts, usuarios o fragmentos de credenciales.
 */
export function errorCode(err: unknown): string {
  const e = err as {
    name?: string;
    code?: unknown;
    message?: string;
    $metadata?: { httpStatusCode?: number };
  };
  if (e?.name === "TIMEOUT") return "TIMEOUT";
  const auth = /^(WRONGPASS|NOAUTH)\b/.exec(e?.message ?? "");
  if (auth) return "AUTH";
  if (typeof e?.code === "string" && SAFE_CODE.test(e.code)) return e.code;
  if (e?.$metadata?.httpStatusCode) return `HTTP_${e.$metadata.httpStatusCode}`;
  if (typeof e?.name === "string" && SAFE_CODE.test(e.name) && e.name !== "Error") return e.name;
  return "ERROR";
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CheckTimeout(ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Ejecuta las comprobaciones en paralelo, cada una con su propio límite de tiempo. */
export async function runChecks(
  checks: Partial<Record<CheckName, () => Promise<void>>>,
  timeoutMs = 5000,
): Promise<CheckResult[]> {
  const entries = Object.entries(checks) as Array<[CheckName, () => Promise<void>]>;
  return Promise.all(
    entries.map(async ([name, run]): Promise<CheckResult> => {
      const started = Date.now();
      try {
        await withTimeout(run(), timeoutMs);
        return { name, ok: true, ms: Date.now() - started };
      } catch (err) {
        return { name, ok: false, ms: Date.now() - started, error: errorCode(err) };
      }
    }),
  );
}

// ---------------------------------------------------------------- comprobaciones

export async function checkPostgres(): Promise<void> {
  await getDb().execute(sql`select 1`);
}

export async function checkRedis(url: string): Promise<void> {
  const redis = new Redis(url, {
    lazyConnect: true,
    connectTimeout: 4000,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  // ioredis informa la causa real (ECONNREFUSED, WRONGPASS...) en el evento "error";
  // connect() solo rechaza con "Connection is closed".
  let cause: unknown;
  redis.on("error", (err) => {
    cause ??= err;
  });
  try {
    await redis.connect();
    if ((await redis.ping()) !== "PONG") throw new Error("respuesta inesperada");
  } catch (err) {
    throw cause ?? err;
  } finally {
    redis.disconnect();
  }
}

export async function checkR2(cfg: {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}): Promise<void> {
  const client = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    maxAttempts: 1,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  try {
    await client.send(new HeadBucketCommand({ Bucket: cfg.bucket }));
  } finally {
    client.destroy();
  }
}

export async function checkSmtp(cfg: {
  host: string;
  port: number;
  user?: string;
  pass?: string;
}): Promise<void> {
  const transport = createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass ?? "" } : undefined,
    connectionTimeout: 4000,
    greetingTimeout: 4000,
    socketTimeout: 4000,
  });
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}

// ---------------------------------------------------------------- informes

/** Comprobación liviana para el balanceador/EasyPanel: ¿el proceso está vivo y ve la base? */
export async function isLive(): Promise<boolean> {
  const [result] = await runChecks({ postgres: checkPostgres }, 3000);
  return result?.ok === true;
}

/** Comprobación completa de Postgres, Redis, R2 y SMTP. Requiere el entorno completo. */
export async function checkDependencies(
  source: Record<string, string | undefined> = process.env,
): Promise<HealthReport> {
  const checkedAt = new Date().toISOString();
  const invalid = envIssues(source);
  if (invalid.length > 0) {
    // Con el entorno incompleto, solo se puede comprobar Postgres (si su variable es válida).
    const checks = invalid.includes("DATABASE_URL") ? [] : await runChecks({ postgres: checkPostgres });
    return { status: "degraded", checkedAt, checks, invalidEnv: invalid };
  }
  const env = parseEnv(source);
  const checks = await runChecks({
    postgres: checkPostgres,
    redis: () => checkRedis(env.REDIS_URL),
    r2: () =>
      checkR2({
        endpoint: env.R2_ENDPOINT,
        region: env.R2_REGION,
        bucket: env.R2_BUCKET,
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      }),
    smtp: () => checkSmtp({ host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, pass: env.SMTP_PASS }),
  });
  return {
    status: checks.every((c) => c.ok) ? "ok" : "degraded",
    checkedAt,
    checks,
  };
}
