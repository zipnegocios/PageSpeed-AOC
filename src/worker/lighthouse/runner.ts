import { access, constants, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch, type LaunchedChrome } from "chrome-launcher";
import lighthouse from "lighthouse";
import desktopConfig from "lighthouse/core/config/desktop-config.js";
import { AuditTimeoutError, ChromeError, LighthouseRuntimeError } from "@/server/domain/audit-errors";
import type { Profile } from "@/server/domain/audit-rules";
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

function hostRule(pinned: PinnedHost): string {
  const ip = pinned.ip.includes(":") ? `[${pinned.ip}]` : pinned.ip;
  return `--host-resolver-rules=MAP ${pinned.host} ${ip}`;
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
  try {
    try {
      chrome = await launch({
        chromePath: input.chromePath || undefined,
        chromeFlags: [...CHROME_FLAGS, ...(input.pinnedHost ? [hostRule(input.pinnedHost)] : [])],
        userDataDir,
        logLevel: "silent",
        handleSIGINT: false,
      });
    } catch (err) {
      throw new ChromeError(err instanceof Error ? err.message : String(err));
    }
    const running = chrome;

    const audit = lighthouse(
      input.url,
      {
        port: running.port,
        output: "json",
        logLevel: "silent",
        onlyCategories: ["performance", "accessibility", "seo", "best-practices"],
        ...(input.profile === "mobile" ? { formFactor: "mobile" as const } : {}),
      },
      input.profile === "desktop" ? desktopConfig : undefined,
    );
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
      chrome?.kill();
    } catch {
      /* ya estaba cerrado */
    }
    await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
  }
};
