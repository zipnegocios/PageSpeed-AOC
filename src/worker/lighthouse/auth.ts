import type { Page } from "puppeteer-core";
import { AuthFailedError } from "@/server/domain/audit-errors";
import type { ProjectAuthConfig } from "@/server/domain/project-auth";
import { isHostAllowed } from "@/server/domain/url-guard";

export type AuthContext = {
  config: ProjectAuthConfig;
  /** Hosts permitidos del proyecto: las credenciales solo se escriben en páginas de estos hosts. */
  allowedHosts: string[];
  /** URL de la ruta a auditar: de ahí salen las cookies. */
  routeUrl: string;
};

const DEFAULT_PASSWORD = 'input[type="password"]';
const DEFAULT_USER =
  'input[type="email"], input[autocomplete="username"], input[name*="user" i], input[name*="email" i], input[name*="login" i], input[id*="user" i], input[id*="email" i], input[type="text"]';
const DEFAULT_SUBMIT = 'button[type="submit"], input[type="submit"]';

const LOGIN_TIMEOUT_MS = 15_000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Los selectores y la página pueden cambiar de contexto en plena navegación: un error ahí es "todavía no". */
async function safely<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};

/**
 * Deja la sesión abierta en `page` antes de auditar. Todos los mensajes de error son fijos: jamás
 * incluyen el usuario, la contraseña, las cookies ni el contenido de la página.
 */
export async function applyAuth(page: Page, ctx: AuthContext): Promise<void> {
  const { config } = ctx;

  if (config.strategy === "cookie") {
    const url = new URL(ctx.routeUrl);
    await page.setCookie(...config.cookies.map((c) => ({ name: c.name, value: c.value, url: url.origin })));
    return;
  }

  const allowed = (url: string) => isHostAllowed(hostOf(url), ctx.allowedHosts);
  const passwordSel = config.passwordSelector || DEFAULT_PASSWORD;

  try {
    await page.goto(config.loginUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  } catch {
    throw new AuthFailedError("AUTH_FAILED", "No se pudo abrir la página de inicio de sesión.");
  }
  // Una redirección a otro host no debe recibir las credenciales.
  if (!allowed(page.url())) {
    throw new AuthFailedError("AUTH_FAILED", "La página de inicio de sesión redirige a un host que no está permitido.");
  }

  const passwordField = await safely(() => page.waitForSelector(passwordSel, { visible: true, timeout: LOGIN_TIMEOUT_MS }));
  if (!passwordField) throw new AuthFailedError("AUTH_FAILED", "No se encontró el campo de contraseña en la página de inicio de sesión.");
  const userField = await safely(() => page.$(config.usernameSelector || DEFAULT_USER));
  if (!userField) throw new AuthFailedError("AUTH_FAILED", "No se encontró el campo de usuario en la página de inicio de sesión.");

  await userField.type(config.username, { delay: 5 });
  await passwordField.type(config.password, { delay: 5 });

  const submit = await safely(() => page.$(config.submitSelector || DEFAULT_SUBMIT));
  const navigation = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => null);
  if (submit) await submit.click();
  else await passwordField.press("Enter");
  await navigation;

  // Éxito: aparece el elemento esperado o, sin él, desaparece el campo de contraseña.
  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  for (;;) {
    const ok = config.successSelector
      ? Boolean(await safely(() => page.$(config.successSelector!)))
      : (await safely(() => page.$(passwordSel))) === null;
    if (ok) break;
    if (Date.now() > deadline) {
      throw new AuthFailedError("AUTH_FAILED", "El inicio de sesión no tuvo éxito: revisa el usuario y la contraseña de prueba.");
    }
    await sleep(300);
  }
  if (!allowed(page.url())) {
    throw new AuthFailedError("AUTH_FAILED", "Tras iniciar sesión la página llevó a un host que no está permitido.");
  }
}
