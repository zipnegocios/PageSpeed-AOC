/**
 * Herramientas del servidor MCP agrupadas por lo que permiten. Una clave guarda los nombres de las
 * herramientas que puede usar; en el panel se eligen con tres presets, nunca nombre por nombre.
 * Quedan fuera por diseño: borrar o archivar, cambiar la fase, rotar links, suspender clientes.
 */
export const READ_TOOLS = [
  "list_projects",
  "get_project",
  "list_routes",
  "get_audit_history",
  "get_audit",
  "get_audit_status",
  "get_thresholds",
] as const;

export const AUDIT_TOOLS = ["run_audit", "discover_routes"] as const;

export const CONFIG_TOOLS = ["set_thresholds", "add_route", "set_route_monitored"] as const;

export const ALL_TOOLS = [...READ_TOOLS, ...AUDIT_TOOLS, ...CONFIG_TOOLS] as const;
export type ToolName = (typeof ALL_TOOLS)[number];

export const PRESET_IDS = ["read", "audit", "configure"] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export const PRESETS: Record<PresetId, { label: string; description: string; tools: readonly ToolName[] }> = {
  read: {
    label: "Solo lectura",
    description: "Consulta proyectos, rutas, umbrales, historial y resultados. No cambia nada ni lanza auditorías.",
    tools: READ_TOOLS,
  },
  audit: {
    label: "Lectura y auditorías",
    description: "Lo anterior, más lanzar auditorías y descubrir rutas en el sitemap. Cada auditoría usa el worker compartido.",
    tools: [...READ_TOOLS, ...AUDIT_TOOLS],
  },
  configure: {
    label: "Lectura, auditorías y configuración",
    description: "Lo anterior, más cambiar umbrales, agregar rutas y elegir cuáles se monitorean. Nunca borra ni cambia fases.",
    tools: ALL_TOOLS,
  },
};

export function scopesForPreset(id: string): ToolName[] {
  if (!(PRESET_IDS as readonly string[]).includes(id)) throw new Error("Permisos no válidos");
  return [...PRESETS[id as PresetId].tools];
}

/** Descubre qué preset corresponde a una lista de herramientas, o "custom" si no coincide con ninguno. */
export function presetOf(scopes: readonly string[]): PresetId | "custom" {
  const set = new Set(scopes);
  for (const id of [...PRESET_IDS].reverse()) {
    const tools = PRESETS[id].tools;
    if (tools.length === set.size && tools.every((t) => set.has(t))) return id;
  }
  return "custom";
}

export const isToolName = (name: string): name is ToolName => (ALL_TOOLS as readonly string[]).includes(name);
