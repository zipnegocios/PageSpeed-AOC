import { access, constants, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch, type LaunchedChrome } from "chrome-launcher";
import lighthouse from "lighthouse";
import puppeteer from "puppeteer-core";
import desktopConfig from "lighthouse/core/config/desktop-config.js";
import { AuditTimeoutError, ChromeError, LighthouseRuntimeError } from "@/server/domain/audit-errors";
import { applyAuth, type AuthContext } from "./auth";
import type { Profile } from "@/server/domain/audit-rules";
import { AuthFailedError } from "@/server/domain/audit-errors";
import { looksLikeLoginRedirect } from "@/server/domain/project-auth";
import type { LhrLike } from "@/server/domain/score-extraction";

export type PinnedHost = { host: string; ip: string };

export type RunnerInput = {
  url: string;
  profile: Profile;
  /** Tiempo máximo duro: pasado este plazo se mata Chromium aunque Lighthouse no responda. */
  timeoutMs: number;
  chromePath?: string;
  /** IP ya validada del host: se fija en Chromium para que no pueda resolver a otra (DNS rebinding). */
  pinnedHost?: PinnedHost;
  /** Otros hosts del flujo (p. ej. la página de login en otro subdominio), igualmente validados y fijados. */
  extraPinnedHosts?: PinnedHost[];
  /** Si la ruta es privada: cómo iniciar sesión antes de auditar. */
  auth?: Omit<AuthContext, "routeUrl">;
};

export type RunnerOutput = { lhr: LhrLike & Record<string, unknown> };
export type LighthouseRunner = (input: RunnerInput) => Promise<RunnerOutput>;

const CHROME_FLAGS = [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--disable-extensions",
  "--disable-background-networking",
  "--no-first-run",
  "--mute-audio",
];

function hostRules(pins: PinnedHost[]): string[] {
  if (pins.length === 0) return [];
  const rules = pins.map((p) => `MAP ${p.host} ${p.ip.includes(":") ? `[${p.ip}]` : p.ip}`);
  return [`--host-resolver-rules=${rules.join(", ")}`];
}

/** Ejecuta una auditoría real con Chromium + Lighthouse y limpia siempre lo que lanzó. */
export const runLighthouse: LighthouseRunner = async (input) => {
  // chrome-launcher no atrapa el error asíncrono de `spawn` con una ruta inexistente: se comprueba antes.
  if (input.chromePath) {
    try {
      await access(input.chromePath, constants.X_OK);
    } catch {
      throw new ChromeError(`No se encontró Chromium ejecutable en ${input.chromePath} (ENOENT)`);
    }
  }
  const userDataDir = await mkdtemp(join(tmpdir(), "aoc-chrome-"));
  let chrome: LaunchedChrome | undefined;
  let browser: Awaited<ReturnType<typeof puppeteer.connect>> | undefined;
  try {
    try {
      chrome = await launch({
        chromePath: input.chromePath || undefined,
        chromeFlags: [...CHROME_FLAGS, ...hostRules([...(input.pinnedHost ? [input.pinnedHost] : []), ...(input.extraPinnedHosts ?? [])])],
        userDataDir,
        logLevel: "silent",
        handleSIGINT: false,
      });
    } catch (err) {
      throw new ChromeError(err instanceof Error ? err.message : String(err));
    }
    const running = chrome;

    const flags = {
      output: "json" as const,
      logLevel: "silent" as const,
      onlyCategories: ["performance", "accessibility", "seo", "best-practices", "agentic-browsing"],
      ...(input.profile === "mobile" ? { formFactor: "mobile" as const } : {}),
    };
    const config = input.profile === "desktop" ? desktopConfig : undefined;
    const audit = (async () => {
      if (!input.auth) return lighthouse(input.url, { ...flags, port: running.port }, config);
      // Páginas privadas: se abre la sesión en una pestaña y Lighthouse audita esa misma pestaña, sin borrar
      // cookies ni almacenamiento (`disableStorageReset`).
      browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${running.port}`, defaultViewport: null });
      const page = await browser.newPage();
      await applyAuth(page, { ...input.auth, routeUrl: input.url });
      const result = await lighthouse(input.url, { ...flags, disableStorageReset: true }, config, page as never);
      const lhr = result?.lhr as { finalDisplayedUrl?: string; finalUrl?: string } | undefined;
      const login = input.auth.config.strategy === "form" ? input.auth.config.loginUrl : undefined;
      if (looksLikeLoginRedirect(input.url, lhr?.finalDisplayedUrl ?? lhr?.finalUrl, login)) {
        throw new AuthFailedError("AUTH_FAILED", "La página llevó al inicio de sesión: la sesión no es válida o ya caducó.");
      }
      return result;
    })();
    audit.catch(() => undefined); // si ganó el plazo, el rechazo tardío no debe quedar sin atender

    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new AuditTimeoutError(input.timeoutMs));
        running.kill();
      }, input.timeoutMs);
    });

    try {
      const result = await Promise.race([audit, deadline]);
      if (!result) throw new LighthouseRuntimeError("INVALID_RESULT", "Lighthouse no devolvió resultado.");
      return { lhr: result.lhr as unknown as RunnerOutput["lhr"] };
    } catch (err) {
      // Lighthouse lanza LighthouseError con un `code` propio (p. ej. "NO_FCP").
      const e = err as { name?: string; code?: unknown; friendlyMessage?: string; message?: string };
      if (e?.name === "LighthouseError" && typeof e.code === "string") {
        throw new LighthouseRuntimeError(e.code, e.friendlyMessage ?? e.message ?? e.code);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  } finally {
    // Siempre: cerrar Chromium y borrar su perfil temporal, incluso tras un fallo o un plazo vencido.
    try {
      await browser?.disconnect();
    } catch {
      /* ya estaba desconectado */
    }
    try {
      chrome?.kill();
    } catch {
      /* ya estaba cerrado */
    }
    await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
  }
};
