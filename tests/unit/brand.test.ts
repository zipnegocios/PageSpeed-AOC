import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BRAND_NAME, COPYRIGHT, COPYRIGHT_LONG, LOGO_BOLT_PATH, LOGO_CORNERS_PATH, LOGO_FRAME_PATH, pageTitle } from "@/lib/brand";
import { DEFAULT_SENDER } from "@/server/domain/client-sender";
import { buildInviteEmail, STAFF_GUIDE } from "@/server/notify/invite-email";
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

  it("los correos al administrador llevan el logo (imagen del propio dominio), el nombre del producto y el copyright", () => {
    const invite = buildInviteEmail({ kind: "invite", invitedBy: "Gustavo", link: "https://app.test/invitacion/x", expiresAt: new Date("2026-12-01T00:00:00Z") });
    expect(invite.html).toContain("https://app.test/brand/logo-glyph-email.png");
    expect(invite.html).toContain("PAGESPEED");
    expect(invite.html).toContain(COPYRIGHT);
    expect(invite.text).toContain(COPYRIGHT);
  });

  it("la invitación al equipo lista, por secciones numeradas, todo lo que se puede hacer en la plataforma", () => {
    const m = buildInviteEmail({ kind: "invite", invitedBy: "Gustavo", link: "https://app.test/invitacion/x", expiresAt: new Date("2026-12-01T00:00:00Z") });
    for (const section of STAFF_GUIDE) {
      expect(m.text).toContain(section.title);
      expect(m.html).toContain(section.title);
    }
    expect(STAFF_GUIDE.map((x) => x.title)).toEqual([
      "Tus clientes y sus proyectos",
      "Auditorías y alertas",
      "SEO, visibilidad y tráfico",
      "Lo que recibe tu cliente",
      "Lo que anotas tú",
      "Agentes (MCP)",
      "En camino",
      "Solo la cuenta propietaria",
    ]);
    expect(m.text).toMatch(/1\. Tus clientes y sus proyectos/);
    expect(m.text).toMatch(/4\. Lo que recibe tu cliente/);
    expect(m.text).toContain("Mi perfil");
    expect(m.text).toContain("WhatsApp");
    expect(m.text).toContain("Quien crea un cliente es su responsable");
    expect(m.text).toContain("MCP");
    expect(m.text).toContain("Integraciones por API con aplicaciones Node y WordPress");
    // La invitación sigue dando el enlace y su vencimiento.
    expect(m.text).toContain("https://app.test/invitacion/x");
    expect(m.text).toContain("vence el");
  });

  it("el restablecimiento de contraseña no lleva el listado", () => {
    const m = buildInviteEmail({ kind: "reset", invitedBy: "Gustavo", link: "https://app.test/invitacion/x", expiresAt: new Date("2026-12-01T00:00:00Z") });
    expect(m.text).not.toContain("QUÉ PUEDES HACER");
    expect(m.html).not.toContain("Qué puedes hacer");
  });

  it("los correos al cliente llevan el logo y tu nombre en la banda y van firmados por ti y zipnegocios, sin el nombre del producto", () => {
    const pin = buildPinEmail({ contactName: null, clientName: "Acme", pin: "123456", portalUrl: "https://app.test/c/acme", sender: DEFAULT_SENDER, appUrl: "https://app.test" });
    const report = buildReportEmail({ contactName: null, projectName: "T", days: 7, portalUrl: "https://app.test/c/acme", sender: DEFAULT_SENDER, appUrl: "https://app.test" });
    for (const m of [pin, report]) {
      expect(m.html).toContain("Gustavo Amarista");
      expect(m.html).toContain("zipnegocios");
      expect(m.html).toContain("https://app.test/brand/logo-glyph-email.png");
      expect(m.html.indexOf("<img")).toBeLessThan(m.html.indexOf("Gustavo Amarista"));
      expect(m.html.replace(/alt="PageSpeed"/g, "")).not.toMatch(/pagespeed/i);
      expect(m.text).toContain("Gustavo Amarista");
      expect(m.text).toContain("zipnegocios");
      expect(m.text).not.toMatch(/pagespeed/i);
      expect(m.text).not.toContain("©");
    }
  });

  it("ya no queda «AOC» en mayúsculas en el código, los documentos ni la configuración", () => {
    const files = [...walk(join(root, "src")), ...walk(join(root, "docs")), ...walk(join(root, "design")), join(root, "README.md"), join(root, "package.json")].filter(
      (f) => !f.includes("/assets/fonts/"),
    );
    const offenders = files.filter((f) => /\bAOC\b/.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => f.replace(root, ""))).toEqual([]);
  });
});
