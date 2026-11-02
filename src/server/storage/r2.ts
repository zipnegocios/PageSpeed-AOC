import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export type R2Config = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export type R2Store = {
  /** Comprime y guarda el JSON. Devuelve los bytes finales. */
  putAuditJson(key: string, data: unknown): Promise<{ bytes: number }>;
  /** Bytes comprimidos tal como están en R2. */
  getAuditGzip(key: string): Promise<Buffer>;
  /** JSON descomprimido y ya interpretado. */
  getAuditJson<T = unknown>(key: string): Promise<T>;
  destroy(): void;
};

export function createR2(cfg: R2Config): R2Store {
  const client = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    maxAttempts: 2,
    // R2 no acepta las sumas de verificación que el SDK reciente añade por defecto (aws-chunked).
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

  async function getAuditGzip(key: string): Promise<Buffer> {
    const res = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
    if (!res.Body) throw new Error("El objeto no tiene contenido");
    return Buffer.from(await res.Body.transformToByteArray());
  }

  return {
    async putAuditJson(key, data) {
      const body = await gzipAsync(Buffer.from(JSON.stringify(data), "utf8"));
      await client.send(
        new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: body, ContentType: "application/gzip" }),
      );
      return { bytes: body.byteLength };
    },
    getAuditGzip,
    async getAuditJson<T>(key: string) {
      return JSON.parse((await gunzipAsync(await getAuditGzip(key))).toString("utf8")) as T;
    },
    destroy: () => client.destroy(),
  };
}

type R2EnvSource = Partial<Record<"R2_ENDPOINT" | "R2_REGION" | "R2_BUCKET" | "R2_ACCESS_KEY_ID" | "R2_SECRET_ACCESS_KEY", string | undefined>>;

export function r2ConfigFromEnv(source: R2EnvSource | NodeJS.ProcessEnv = process.env): R2Config {
  const { R2_ENDPOINT, R2_REGION, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = source;
  if (!R2_ENDPOINT || !R2_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new Error("Faltan variables de R2 (R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)");
  }
  return {
    endpoint: R2_ENDPOINT,
    region: R2_REGION || "auto",
    bucket: R2_BUCKET,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  };
}

const g = globalThis as unknown as { __aocR2?: R2Store };

/** Cliente de R2 compartido por el proceso (web o worker). */
export function getR2(): R2Store {
  return (g.__aocR2 ??= createR2(r2ConfigFromEnv()));
}
