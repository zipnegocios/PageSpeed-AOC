import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BRAND_NAME, COPYRIGHT, COPYRIGHT_LONG, LOGO_BOLT_PATH, LOGO_CORNERS_PATH, LOGO_FRAME_PATH, pageTitle } from "@/lib/brand";
import { buildPinEmail } from "@/server/notify/pin-email";
import { buildReportEmail } from "@/server/notify/report-email";

const root = join(__dirname, "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css|md|json|mjs|yml)$/.test(name)) out.push(p);
  }
  return out;
}

describe("marca", () => {
  it("el nombre es PageSpeed y los títulos llevan «· PageSpeed»", () => {
    expect(BRAND_NAME).toBe("PageSpeed");
    expect(pageTitle("Alertas")).toBe("Alertas · PageSpeed");
  });

  it("el copyright es de zipnegocios (en minúsculas) y de Gustavo Amarista", () => {
    expect(COPYRIGHT).toBe("© 2026 zipnegocios · Gustavo Amarista");
    expect(COPYRIGHT).not.toMatch(/Zipnegocios|ZIPNEGOCIOS/);
    expect(COPYRIGHT_LONG).toBe("© 2026 zipnegocios · Gustavo Amarista. Todos los derechos reservados.");
    expect(readFileSync(join(root, "LICENSE"), "utf8")).toContain(COPYRIGHT_LONG);
  });

  it("la geometría del código es la de los SVG de design/brand", () => {
    const mark = readFileSync(join(root, "design/brand/logo-mark.svg"), "utf8");
    expect(mark).toContain(`d="${LOGO_BOLT_PATH}"`);
    expect(mark).toContain(`d="${LOGO_FRAME_PATH}"`);
    expect(mark).toContain(`d="${LOGO_CORNERS_PATH}"`);
    expect(readFileSync(join(root, "design/brand/logo-glyph.svg"), "utf8")).toContain(`d="${LOGO_BOLT_PATH}"`);
  });

  it("los correos llevan el logo (imagen del propio dominio), el nombre y el copyright", () => {
    const pin = buildPinEmail({ contactName: null, clientName: "Acme", pin: "123456", portalUrl: "https://app.test/c/acme" });
    expect(pin.html).toContain("https://app.test/brand/logo-glyph-email.png");
    expect(pin.html).toContain("PAGESPEED");
    expect(pin.html).toContain(COPYRIGHT);
    expect(pin.text).toContain(COPYRIGHT);
    const report = buildReportEmail({ contactName: null, projectName: "T", days: 7, portalUrl: "https://app.test/c/acme" });
    expect(report.html).toContain(COPYRIGHT);
    expect(report.text).toContain(COPYRIGHT);
  });

  it("ya no queda «AOC» en mayúsculas en el código, los documentos ni la configuración", () => {
    const files = [...walk(join(root, "src")), ...walk(join(root, "docs")), ...walk(join(root, "design")), join(root, "README.md"), join(root, "package.json")].filter(
      (f) => !f.includes("/assets/fonts/"),
    );
    const offenders = files.filter((f) => /\bAOC\b/.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => f.replace(root, ""))).toEqual([]);
  });
});
