/*
 * Comprobación manual de que el portal cabe en la pantalla del teléfono (sin desplazamiento horizontal) y de que las barras
 * superior e inferior siguen fijas al desplazar. Recorre las cinco pestañas a 320, 360, 375, 390 y 412 px y lista los elementos
 * que se salen. Úsala con títulos de página largos (60 caracteres): con títulos cortos los desbordes no se ven.
 *
 *   PORTAL_BASE=http://localhost:3000 PORTAL_CLIENT=<slug del cliente> PORTAL_PROJECT=<slug del proyecto> PORTAL_PIN=<PIN> \
 *     node scripts/portal-fit-audit.mjs [carpeta-para-capturas]
 *
 * Necesita Playwright (`require("playwright")`) y el servidor en marcha. Sale con código 1 si algo no cabe.
 */
import { createRequire } from "node:module";

// Playwright suele estar instalado fuera del proyecto (global): se resuelve con `require`, que sí respeta NODE_PATH.
const { chromium } = createRequire(import.meta.url)("playwright");
const SCR = process.argv[2];
const PIN = process.env.PORTAL_PIN;
const B = process.env.PORTAL_BASE ?? "http://localhost:3000";
const S = `/c/${process.env.PORTAL_CLIENT}`;
const P = `${S}/${process.env.PORTAL_PROJECT}`;
if (!PIN || !process.env.PORTAL_CLIENT || !process.env.PORTAL_PROJECT) {
  console.error("Faltan PORTAL_CLIENT, PORTAL_PROJECT y PORTAL_PIN.");
  process.exit(2);
}
const WIDTHS = [320, 360, 375, 390, 412];
const PAGES = [["resumen", ""], ["rutas", "/rutas"], ["mejoras", "/mejoras"], ["trafico", "/trafico?seccion=visitas"], ["informes", "/informes"]];
(async () => {
  const browser = await chromium.launch();
  let bad = 0;
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(B + S, { waitUntil: "networkidle" });
    await page.fill("#pin", PIN);
    await Promise.all([page.waitForURL(/tecnostar-com/, { timeout: 60000 }), page.click('button:has-text("Entrar")')]);
    for (const [name, path] of PAGES) {
      await page.goto(B + P + path, { waitUntil: "networkidle" });
      const r = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const sw = document.documentElement.scrollWidth;
        const offenders = [];
        for (const el of document.querySelectorAll("main *")) {
          const b = el.getBoundingClientRect();
          if (b.width > 0 && b.right > vw + 1) offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 3).join(".")} right=${Math.round(b.right)}`);
        }
        return { vw, sw, offenders: offenders.slice(0, 4), n: offenders.length };
      });
      // barras fijas tras desplazar
      await page.evaluate(() => window.scrollTo(0, 600));
      const bars = await page.evaluate(() => {
        const t = document.querySelector(".portal-topbar")?.getBoundingClientRect();
        const b = document.querySelector(".portal-tabbar")?.getBoundingClientRect();
        return { top: t ? Math.round(t.top) : null, tabTop: b ? Math.round(b.top) : null, tabBottom: b ? Math.round(b.bottom) : null, tabW: b ? Math.round(b.width) : null, vh: window.innerHeight };
      });
      const ok = r.sw <= r.vw + 1 && r.n === 0 && bars.top === 0 && bars.tabBottom === bars.vh;
      if (!ok) bad++;
      console.log(`${ok ? "OK " : "MAL"} ${w}px ${name.padEnd(8)} scrollW=${r.sw}/${r.vw} fuera=${r.n} barra-sup.top=${bars.top} barra-inf.bottom=${bars.tabBottom}/${bars.vh}${r.offenders.length ? " " + JSON.stringify(r.offenders) : ""}`);
      if (SCR && w === 360) await page.screenshot({ path: `${SCR}/fit-${w}-${name}.png` });
    }
    await ctx.close();
  }
  console.log(bad === 0 ? "TODO BIEN" : `${bad} combinaciones con problema`);
  await browser.close();
  process.exit(bad === 0 ? 0 : 1);
})();
