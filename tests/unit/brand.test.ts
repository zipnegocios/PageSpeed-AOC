import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BRAND_NAME, COPYRIGHT, COPYRIGHT_LONG, LOGO_BOLT_PATH, LOGO_CORNERS_PATH, LOGO_FRAME_PATH, pageTitle } from "@/lib/brand";
import { DEFAULT_SENDER } from "@/server/domain/client-sender";
import { buildInviteEmail, STAFF_GUIDE } from "@/server/notify/invite-email";
import { buildPinEmail } from "@/server/notify/pin-email";
import { buildClientReportEmail } from "@/server/notify/client-emails";

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

  const expiresAt = new Date("2026-12-01T00:00:00Z");
  const invite = (extra: Partial<Parameters<typeof buildInviteEmail>[0]> = {}) =>
    buildInviteEmail({ kind: "invite", inviterName: "Gustavo Amarista", inviteeName: "Luis", link: "https://app.test/invitacion/x", expiresAt, ...extra });

  it("los correos al administrador llevan el logo (imagen del propio dominio), el nombre del producto y el copyright", () => {
    const m = invite();
    expect(m.html).toContain("https://app.test/brand/logo-glyph-email.png");
    expect(m.html).toContain("PAGESPEED");
    expect(m.html).toContain(COPYRIGHT);
  });

  it("la invitación la escribe una persona a otra: saluda por el nombre, habla en primera persona y firma", () => {
    const m = invite();
    expect(m.subject).toBe("Gustavo Amarista te invita a PageSpeed");
    for (const out of [m.text, m.html]) {
      expect(out).toContain("Hola Luis,");
      expect(out).not.toMatch(/te invitó|junto con su equipo|gustavo@/i);
    }
    expect(m.text).toContain("Soy Gustavo Amarista y te invito a PageSpeed, la plataforma desde la que llevo la observabilidad de los activos digitales de mis clientes");
    expect(m.text).toContain("crea tu cartera o únete a la mía");
    expect(m.text).toContain("Ellos verán tu nombre en cada correo y en su portal");
    expect(m.text).toMatch(/PARA EMPEZAR\n1\. Crea tu contraseña[\s\S]*2\. Completa tu perfil: nombre, apellido y WhatsApp[\s\S]*3\. Lee abajo[\s\S]*4\. Crea tu primer cliente/);
    expect(m.text).toContain("Cualquier duda, respóndeme este correo: me llega directo.");
    expect(m.text).toContain("\nGustavo Amarista\n");
    // Sigue dando el enlace y su vencimiento.
    expect(m.text).toContain("https://app.test/invitacion/x");
    expect(m.text).toContain("vence el 1 de diciembre de 2026 (UTC)");
    expect(m.text).toContain("sin el enlace nadie puede entrar con tu correo");
  });

  it("sin nombre de quien recibe, saluda sin nombre en lugar de inventarlo", () => {
    expect(invite({ inviteeName: null }).text.startsWith("Hola,\n")).toBe(true);
    expect(invite({ inviteeName: "  " }).text.startsWith("Hola,\n")).toBe(true);
  });

  it("escapa los nombres", () => {
    const m = invite({ inviterName: "G <b>x</b>", inviteeName: "L <i>" });
    expect(m.html).not.toContain("<b>x</b>");
    expect(m.html).not.toContain("<i>");
    expect(m.html).toContain("G &lt;b&gt;x&lt;/b&gt;");
  });

  it("lista, por secciones numeradas, todo lo que se puede hacer: los dos modos, los agentes, el acceso por persona y lo que recibe el cliente", () => {
    const m = invite();
    for (const section of STAFF_GUIDE) {
      expect(m.text).toContain(section.title);
      expect(m.html).toContain(section.title);
    }
    expect(STAFF_GUIDE.map((x) => x.title)).toEqual([
      "Tus clientes y sus proyectos",
      "Los dos modos de uso: desarrollo y producción",
      "Auditorías y alertas",
      "SEO, visibilidad y tráfico",
      "Lo que recibe tu cliente",
      "Lo que anotas tú",
      "Agentes de IA (MCP): desarrollo y producción",
      "En camino",
      "Solo la cuenta propietaria",
    ]);
    expect(m.text).toMatch(/1\. Tus clientes y sus proyectos/);
    expect(m.text).toMatch(/2\. Los dos modos de uso: desarrollo y producción/);
    expect(m.text).toMatch(/7\. Agentes de IA \(MCP\): desarrollo y producción/);
    // Los dos modos y el desarrollo guiado por especificaciones con IA.
    for (const t of ["Modo desarrollo (estás construyendo o mejorando)", "Modo producción (el producto ya está publicado)", "Spec-Driven Development", "criterio de aceptación", "cambiar la fase del proyecto"]) expect(m.text).toContain(t);
    expect(m.text).toContain("En desarrollo: son el motor del desarrollo acelerado con IA");
    expect(m.text).toContain("En producción: responden «¿cómo va este cliente?»");
    // Todo se dice sin negritas sueltas en el texto plano, y con negritas en el HTML.
    expect(m.text).not.toContain("**");
    expect(m.html).toContain("<b>Modo desarrollo");
    // El modelo de acceso por persona.
    expect(m.text).toContain("Ves tus clientes y lo que otra persona del equipo te comparta");
    expect(m.text).toContain("nunca ve más que tú");
    expect(m.text).toContain("sus clientes pasan al propietario");
    // Varios productos y la mejora inicial.
    expect(m.text).toContain("Un cliente puede tener varios productos a la vez");
    expect(m.text).toContain("en mejora inicial");
    expect(m.text).toContain("Integraciones por API con aplicaciones Node y WordPress");
  });

  it("el restablecimiento de contraseña es breve, en primera persona y sin el listado", () => {
    const m = invite({ kind: "reset" });
    expect(m.subject).toBe("Crea una contraseña nueva en PageSpeed");
    expect(m.text).toContain("Hola Luis,");
    expect(m.text).toContain("Te envío este enlace para que crees una contraseña nueva en PageSpeed. La anterior dejará de servir.");
    expect(m.text).not.toContain("LO QUE PUEDES HACER");
    expect(m.html).not.toContain("Lo que puedes hacer");
    expect(m.text).not.toContain("PARA EMPEZAR");
    expect(m.text).toContain("\nGustavo Amarista\n");
  });

  it("los correos al cliente llevan el logo y tu nombre en la banda y van firmados por ti y zipnegocios, sin el nombre del producto", () => {
    const pin = buildPinEmail({ contactName: null, clientName: "Acme", pin: "123456", portalUrl: "https://app.test/c/acme", sender: DEFAULT_SENDER, appUrl: "https://app.test" });
    const report = buildClientReportEmail({ names: [], clientName: "Acme", site: "t.com", periodLabel: "últimos 7 días", summaryLine: "Todo bien.", portalUrl: "https://app.test/c/acme", sender: DEFAULT_SENDER, appUrl: "https://app.test" });
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
