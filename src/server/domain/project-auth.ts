import { z } from "zod";
import { DomainError } from "./errors";

/** Configuración de acceso a páginas privadas de un proyecto. Se guarda cifrada. */
export const cookieAuthSchema = z.object({
  strategy: z.literal("cookie"),
  cookies: z
    .array(z.object({ name: z.string().min(1).max(200), value: z.string().min(1).max(4096) }))
    .min(1, { error: "Agrega al menos una cookie." })
    .max(20, { error: "Se admiten hasta 20 cookies." }),
});

const selector = z.string().trim().max(200).optional();

export const formAuthSchema = z.object({
  strategy: z.literal("form"),
  /** URL completa de la página de inicio de sesión, ya dentro de un host permitido. */
  loginUrl: z.string().min(1).max(500),
  username: z.string().min(1, { error: "Escribe el usuario de prueba." }).max(200),
  password: z.string().min(1, { error: "Escribe la contraseña del usuario de prueba." }).max(500),
  usernameSelector: selector,
  passwordSelector: selector,
  submitSelector: selector,
  /** Si existe en la página tras entrar, el login se considera correcto. */
  successSelector: selector,
});

export const projectAuthSchema = z.discriminatedUnion("strategy", [cookieAuthSchema, formAuthSchema]);
export type ProjectAuthConfig = z.infer<typeof projectAuthSchema>;
export type CookieAuth = z.infer<typeof cookieAuthSchema>;
export type FormAuth = z.infer<typeof formAuthSchema>;

const COOKIE_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * Cookies desde texto libre: una por línea (`nombre=valor`) o pegadas de una cabecera `Cookie:`
 * separadas por `;`. El valor puede contener `=`.
 */
export function parseCookieText(text: string): CookieAuth["cookies"] {
  const out: CookieAuth["cookies"] = [];
  for (const raw of text.replace(/^\s*cookie:\s*/i, "").split(/[\n;]+/)) {
    const part = raw.trim();
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq < 1) throw new DomainError("INVALID", `«${part.slice(0, 30)}» no tiene el formato nombre=valor.`);
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!COOKIE_NAME.test(name)) throw new DomainError("INVALID", `El nombre de cookie «${name.slice(0, 30)}» no es válido.`);
    if (!value || CONTROL.test(value)) throw new DomainError("INVALID", `La cookie ${name} tiene un valor vacío o con caracteres no válidos.`);
    out.push({ name, value });
  }
  if (out.length === 0) throw new DomainError("INVALID", "Pega al menos una cookie (nombre=valor).");
  return out;
}

/** Datos que se pueden mostrar sin riesgo. */
export type AuthSummary =
  | { configured: false }
  | { configured: true; strategy: "cookie"; cookieNames: string[]; unreadable?: false }
  | { configured: true; strategy: "form"; loginUrl: string; username: string; unreadable?: false }
  | { configured: true; strategy: "cookie" | "form"; unreadable: true };

export function summarize(config: ProjectAuthConfig): Exclude<AuthSummary, { unreadable: true } | { configured: false }> {
  return config.strategy === "cookie"
    ? { configured: true, strategy: "cookie", cookieNames: config.cookies.map((c) => c.name) }
    : { configured: true, strategy: "form", loginUrl: config.loginUrl, username: config.username };
}

const LOGIN_PATH = /\/(log-?in|sign-?in|signin|iniciar-sesion|acceso|auth|account\/login|wp-login\.php|users?\/sign_in)(\/|$|\.)/i;

/**
 * ¿Pedimos una página privada y terminamos en el inicio de sesión? Entonces la sesión no valió
 * (cookies caducadas o login que no dejó sesión) y la auditoría mediría la página equivocada.
 */
export function looksLikeLoginRedirect(requestedUrl: string, finalUrl: string | undefined, loginUrl?: string): boolean {
  if (!finalUrl) return false;
  try {
    const wanted = new URL(requestedUrl);
    const got = new URL(finalUrl);
    if (got.origin === wanted.origin && got.pathname === wanted.pathname) return false;
    if (loginUrl) {
      const login = new URL(loginUrl);
      if (got.origin === login.origin && got.pathname === login.pathname) return true;
    }
    return LOGIN_PATH.test(got.pathname) && !LOGIN_PATH.test(wanted.pathname);
  } catch {
    return false;
  }
}
