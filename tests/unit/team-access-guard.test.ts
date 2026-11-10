import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guardas estáticas del control de acceso del equipo: que nadie añada una acción, una ruta o una pantalla de administración sin pasar
 * por el filtro. Si una prueba falla, usa una guarda de `@/lib/auth/access` (o pasa el alcance al listado) en vez de añadir una excepción.
 */

const ROOT = process.cwd();
function files(dir: string, match: RegExp): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p, match) : match.test(p) ? [p] : [];
  });
}
const rel = (p: string) => p.replace(`${ROOT}/`, "");

/** Acciones que no tocan clientes ni proyectos de nadie: la sesión basta. */
const SESSION_ONLY = new Set(["createClientAction", "logoutAction"]);
/** Carpetas de acciones propias de la persona o solo del propietario (ya usan `assertOwner`/`verifySession` con sus propios datos). */
const OWN_ACTION_DIRS = ["src/app/admin/equipo/", "src/app/admin/perfil/"];

describe("equipo: nada de administración sin guarda", () => {
  it("toda acción de servidor de clientes, proyectos, SEO, archivados, cola y agentes llama a una guarda de acceso", () => {
    const offenders: string[] = [];
    for (const file of files(join(ROOT, "src/app/admin"), /actions\.ts$/)) {
      if (OWN_ACTION_DIRS.some((d) => rel(file).startsWith(d)) || rel(file) === "src/app/admin/actions.ts") continue;
      const chunks = readFileSync(file, "utf8").split(/^export async function /m).slice(1);
      for (const chunk of chunks) {
        const name = chunk.slice(0, chunk.indexOf("("));
        if (SESSION_ONLY.has(name)) continue;
        if (!/\brequire[A-Z]\w*\(/.test(chunk)) offenders.push(`${rel(file)}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("toda ruta de /api/admin que no sea la foto de perfil comprueba el acceso a lo que sirve", () => {
    const offenders = files(join(ROOT, "src/app/api/admin"), /route\.ts$/)
      .filter((f) => !rel(f).includes("/avatar/"))
      .filter((f) => !/\bapi(Project|Audit|Client)Access\(|\bapiGuard\(/.test(readFileSync(f, "utf8")))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("ninguna pantalla ni cargador del panel lista clientes, proyectos, alertas ni cola sin pasar el alcance", () => {
    const LIST = /\b(listClients|listAllProjects|listOpenAlerts|getFleet|listRecentPagesGlobal|getQueueStatus|getSeoOverview|listArchivedClients|listArchivedProjects)\(\s*\)/;
    const offenders: string[] = [];
    for (const file of [...files(join(ROOT, "src/app/admin"), /\.tsx?$/), ...files(join(ROOT, "src/app/oauth"), /\.tsx?$/)]) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((l, i) => {
        if (LIST.test(l)) offenders.push(`${rel(file)}:${i + 1}: ${l.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("las pantallas de administración con un id en la dirección usan una guarda (no solo verifySession)", () => {
    const pages = ["src/app/admin/clientes/[cliente]/page.tsx", "src/app/admin/clientes/[cliente]/[proyecto]/page.tsx", "src/app/admin/clientes/[cliente]/[proyecto]/seo/page.tsx", "src/app/admin/proyectos/[id]/page.tsx", "src/app/admin/auditorias/[id]/page.tsx", "src/app/admin/auditorias/[id]/informe/page.tsx"];
    for (const p of pages) expect(readFileSync(join(ROOT, p), "utf8"), p).toMatch(/\b(require[A-Z]\w*|clientLevelOf)\(/);
  });
});
