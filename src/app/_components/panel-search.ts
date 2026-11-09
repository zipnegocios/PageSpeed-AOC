/** Parámetros de dirección de los paneles de una misma pantalla (evolución y datos reales): cada uno conserva los del otro. */
export type PanelSearch = {
  ruta?: string;
  perfil?: string;
  m?: string;
  dias?: string;
  campo?: string;
  cruta?: string;
  cdisp?: string;
  /** Periodo y idioma de «Tráfico y búsqueda»: con otro nombre que `dias`, para no pisar el periodo de la evolución. */
  periodo?: string;
  idioma?: string;
};

const KEYS = ["ruta", "perfil", "m", "dias", "campo", "cruta", "cdisp", "periodo", "idioma"] as const;

export function panelHref(basePath: string, search: PanelSearch, patch: Partial<Record<keyof PanelSearch, string | null>>, anchor: string): string {
  const q = new URLSearchParams();
  for (const k of KEYS) {
    const v = k in patch ? patch[k] : search[k];
    if (v) q.set(k, v);
  }
  const qs = q.toString();
  return `${basePath}${qs ? `?${qs}` : ""}#${anchor}`;
}
