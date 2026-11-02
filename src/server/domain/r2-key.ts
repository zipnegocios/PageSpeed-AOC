import { slugify } from "./slug";

export type AuditKeyInput = {
  clientSlug: string;
  projectSlug: string;
  routePath: string;
  profile: "mobile" | "desktop";
  auditId: string;
  at: Date;
};

/** "/" -> "home"; "/blog/mi-post" -> "blog-mi-post". Máximo 60 caracteres. */
export function routeSlug(path: string): string {
  if (path === "/" || path === "") return "home";
  return slugify(path).slice(0, 60).replace(/-+$/, "") || "ruta";
}

/**
 * Clave del JSON completo de una auditoría en R2:
 *   {cliente}/{proyecto}/{año}/{mes}/{AAAAMMDDThhmmssZ}_{ruta}_{perfil}_{auditId}.json.gz
 * Todo en UTC. Agrupar por cliente/proyecto permite borrar o mover un historial completo.
 */
export function buildAuditKey(i: AuditKeyInput): string {
  const iso = i.at.toISOString(); // 2026-11-02T15:30:45.123Z
  const year = iso.slice(0, 4);
  const month = iso.slice(5, 7);
  const stamp = iso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"); // 20261102T153045Z
  return `${i.clientSlug}/${i.projectSlug}/${year}/${month}/${stamp}_${routeSlug(i.routePath)}_${i.profile}_${i.auditId}.json.gz`;
}
