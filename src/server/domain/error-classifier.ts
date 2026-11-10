import { isDomainError } from "./errors";
import { AuditTimeoutError, AuthFailedError, ChromeError, LighthouseRuntimeError } from "./audit-errors";

export type ClassifiedError = {
  /** Se guarda en audit_logs.error_code. */
  code: string;
  /** Si es true, tiene sentido volver a intentarlo. */
  retryable: boolean;
  /** Texto corto y seguro para mostrar (sin credenciales ni rutas del sistema). */
  message: string;
};

const MAX_MESSAGE = 300;
const clip = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, MAX_MESSAGE);

const R2_CONFIG_ERRORS = new Set(["AccessDenied", "NoSuchBucket", "InvalidAccessKeyId", "SignatureDoesNotMatch", "Forbidden"]);
const TRANSIENT_4XX = new Set(["408", "425", "429"]);
const NETWORK_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EPIPE"]);

/** Añade una nota al mensaje de un fallo, sin pasar del tope. */
export function withNote(failure: ClassifiedError, note: string): ClassifiedError {
  return note ? { ...failure, message: clip(`${failure.message} ${note}`) } : failure;
}

/** Traduce un error de Lighthouse (`runtimeError.code`) a un código propio. */
function fromLighthouse(code: string, message: string): ClassifiedError {
  const status = /status code:?\s*(\d{3})/i.exec(message)?.[1];
  switch (code) {
    case "NO_FCP":
    case "NO_LCP":
    case "NO_FMP":
      return { code: "NO_FCP", retryable: true, message: clip("La página no mostró contenido a tiempo.") };
    case "PAGE_HUNG":
      return { code: "PAGE_HUNG", retryable: true, message: clip("La página dejó de responder durante la auditoría.") };
    case "DNS_FAILURE":
    case "FAILED_DOCUMENT_REQUEST":
      return { code: "SITE_DOWN", retryable: true, message: clip(`No se pudo cargar el sitio. ${message}`) };
    case "ERRORED_DOCUMENT_REQUEST":
      if (status && status.startsWith("5")) return { code: "HTTP_5XX", retryable: true, message: clip(`El sitio respondió con error ${status}.`) };
      // 408, 425 y 429 son pasajeros (el sitio pide esperar): se reintentan. El resto de 4xx no cambia por esperar.
      if (status && status.startsWith("4")) return { code: "HTTP_4XX", retryable: TRANSIENT_4XX.has(status), message: clip(`La página respondió con error ${status}.`) };
      return { code: "SITE_DOWN", retryable: true, message: clip(`El sitio respondió con error. ${message}`) };
    case "INSECURE_DOCUMENT_REQUEST":
      return { code: "TLS_ERROR", retryable: false, message: clip("El certificado del sitio no es válido.") };
    case "PROTOCOL_TIMEOUT":
      return { code: "TIMEOUT", retryable: true, message: clip("Chromium tardó demasiado en responder.") };
    default:
      return { code: code || "UNKNOWN", retryable: true, message: clip(message || code) };
  }
}

/** Clasifica cualquier error del procesador de auditorías. Nunca devuelve el error original. */
export function classifyError(err: unknown): ClassifiedError {
  if (err instanceof AuditTimeoutError) return { code: "TIMEOUT", retryable: true, message: clip(err.message) };
  if (err instanceof LighthouseRuntimeError) return fromLighthouse(err.lhCode, err.message);
  // Credenciales o sesión inválidas no se arreglan reintentando: se avisa y se espera a que alguien las corrija.
  if (err instanceof AuthFailedError) return { code: err.authCode, retryable: false, message: clip(err.message) };
  if ((err as { name?: string })?.name === "SecretBoxError") {
    return { code: "AUTH_CONFIG", retryable: false, message: clip("No se pudo leer el acceso guardado: revisa AUTH_ENCRYPTION_KEY en el worker (debe ser la misma que en el web).") };
  }

  if (isDomainError(err)) {
    if (err.code === "FORBIDDEN_HOST") return { code: "FORBIDDEN_HOST", retryable: false, message: clip(err.message) };
    if (err.code === "NOT_FOUND") return { code: "NOT_FOUND", retryable: false, message: clip(err.message) };
    if (err.code === "UPSTREAM") return { code: "SITE_DOWN", retryable: true, message: clip(err.message) };
    return { code: "INVALID", retryable: false, message: clip(err.message) };
  }

  const e = err as { name?: string; code?: unknown; message?: string; $metadata?: { httpStatusCode?: number } };
  const text = `${e?.name ?? ""} ${e?.message ?? ""}`;

  if (err instanceof ChromeError || /ChromeNotInstalled/i.test(text)) {
    if (/not installed|no chrome|ENOENT/i.test(text)) {
      return { code: "CHROME_MISSING", retryable: false, message: clip("No se encontró Chromium en el worker.") };
    }
    return { code: "CHROME_CRASH", retryable: true, message: clip("Chromium falló durante la auditoría.") };
  }
  if (/Target closed|Protocol error|Session closed|Browser has disconnected|Chrome (?:process )?(?:exited|crashed)/i.test(text)) {
    return { code: "CHROME_CRASH", retryable: true, message: clip("Chromium se cerró durante la auditoría.") };
  }

  // Almacenamiento (R2 / S3)
  const http = e?.$metadata?.httpStatusCode;
  if ((typeof e?.name === "string" && R2_CONFIG_ERRORS.has(e.name)) || http === 401 || http === 403 || http === 404) {
    return { code: "R2_CONFIG", retryable: false, message: clip("No hay acceso al almacenamiento (revisa el bucket y las claves de R2).") };
  }
  if ((typeof http === "number" && http >= 500) || (typeof e?.code === "string" && NETWORK_CODES.has(e.code))) {
    return { code: "R2_UNAVAILABLE", retryable: true, message: clip("El almacenamiento no respondió.") };
  }

  return { code: "UNKNOWN", retryable: true, message: clip(e?.message ?? "Error desconocido.") };
}
