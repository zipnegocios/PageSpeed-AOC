import { access, constants, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch, type LaunchedChrome } from "chrome-launcher";
import puppeteer from "puppeteer-core";
import { CHROME_FLAGS, hostRules, type PinnedHost } from "./runner";

/**
 * Prueba con Chromium real cuando un sitio da 403 a Lighthouse pero responde bien a peticiones sencillas del mismo worker: el cortafuegos distingue
 * al navegador. Navega a la dirección con las mismas banderas y registra lo que recibió; luego prueba cada palanca razonable por separado, para que el
 * mensaje de la auditoría diga cuál abre la puerta. Nunca lanza, cierra siempre Chromium y borra su perfil.
 */
export type ChromiumVariantId = "base" | "unpinned" | "stealth" | "http1";
export type ChromiumVariant = { id: ChromiumVariantId; label: string; flags: string[]; pin: boolean };

export const CHROMIUM_VARIANTS: readonly ChromiumVariant[] = [
  { id: "base", label: "Chromium", flags: [], pin: true },
  { id: "unpinned", label: "sin fijar IP", flags: [], pin: false },
  { id: "stealth", label: "sin señales de automatización", flags: ["--disable-blink-features=AutomationControlled", "--lang=es-ES", "--accept-lang=es-ES"], pin: true },
  { id: "http1", label: "HTTP/1.1", flags: ["--disable-http2", "--disable-quic"], pin: true },
];

export type ChromiumAttempt = { variant: ChromiumVariant; status: number | null; server: string | null; excerpt: string };
export type ChromiumProbe = { attempts: ChromiumAttempt[]; /** La primera palanca con la que el sitio responde bien; `base` si ya pasa sin cambios. */ winner: ChromiumVariant | null };
export type ChromiumProbeFn = (url: string, pin: PinnedHost | undefined, opts: { chromePath?: string }) => Promise<ChromiumProbe | null>;

const tidy = (text: string, max: number) => text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const passes = (a: ChromiumAttempt) => a.status !== null && a.status < 400;

async function attempt(url: string, variant: ChromiumVariant, pin: PinnedHost | undefined, opts: { chromePath?: string; navTimeoutMs: number }): Promise<ChromiumAttempt> {
  const out: ChromiumAttempt = { variant, status: null, server: null, excerpt: "" };
  // chrome-launcher no atrapa el error asíncrono de `spawn` con una ruta inexistente: se comprueba antes (igual que en `runner.ts`).
  if (opts.chromePath) {
    try {
      await access(opts.chromePath, constants.X_OK);
    } catch {
      return out;
    }
  }
  const userDataDir = await mkdtemp(join(tmpdir(), "pagespeed-probe-"));
  let chrome: LaunchedChrome | undefined;
  try {
    chrome = await launch({
      chromePath: opts.chromePath || undefined,
      chromeFlags: [...CHROME_FLAGS, ...variant.flags, ...(variant.pin && pin ? hostRules([pin]) : [])],
      userDataDir,
      logLevel: "silent",
      handleSIGINT: false,
    });
    const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${chrome.port}`, defaultViewport: null });
    try {
      const page = await browser.newPage();
      page.on("response", (res) => {
        const req = res.request();
        if (!req.isNavigationRequest() || req.frame() !== page.mainFrame()) return;
        out.status = res.status(); // la última redirección manda
        const server = res.headers()["server"];
        out.server = server ? tidy(server, 40) : null;
      });
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: opts.navTimeoutMs }).catch(() => undefined);
      out.excerpt = tidy(await page.evaluate(() => `${document.title} ${document.body?.innerText ?? ""}`).catch(() => ""), 60);
    } finally {
      await browser.disconnect().catch(() => undefined);
    }
  } catch {
    /* Chromium no arrancó o la navegación falló: queda «sin respuesta» */
  } finally {
    try {
      chrome?.kill();
    } catch {
      /* ya estaba cerrado */
    }
    await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
  }
  return out;
}

export const probeChromium: ChromiumProbeFn = async (url, pin, opts) => {
  const deadline = Date.now() + 60_000;
  const attempts: ChromiumAttempt[] = [];
  try {
    for (const variant of CHROMIUM_VARIANTS) {
      if (Date.now() > deadline) break;
      const a = await attempt(url, variant, pin, { chromePath: opts.chromePath, navTimeoutMs: 15_000 });
      attempts.push(a);
      // Si ni Chromium base se pudo usar, o ya pasa sin cambios, no hay más que comparar.
      if (variant.id === "base" && (a.status === null || passes(a))) break;
    }
    const winner = attempts.find(passes)?.variant ?? null;
    return { attempts, winner };
  } catch {
    return null;
  }
};

const show = (a: ChromiumAttempt) => (a.status === null ? "sin respuesta" : String(a.status));

/** Una frase para el mensaje del fallo: lo que recibió Chromium y qué variantes pasan. */
export function describeChromium(p: ChromiumProbe | null): string {
  if (!p || p.attempts.length === 0) return "";
  const [base, ...rest] = p.attempts;
  const head = `${base!.variant.label} ${show(base!)}${base!.excerpt ? ` «${base!.excerpt}»` : ""}`;
  return `Navegador: ${[head, ...rest.map((a) => `${a.variant.label} ${show(a)}`)].join(" · ")}.`;
}
