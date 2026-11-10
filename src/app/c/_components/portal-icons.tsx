import type { ReactNode } from "react";

/** Iconos de línea de las pestañas (24 px, trazo de 1,75). Decorativos: el texto de la pestaña los nombra. */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      {children}
    </svg>
  );
}

export const TabIcons = {
  resumen: (
    <Icon>
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
    </Icon>
  ),
  rutas: (
    <Icon>
      <circle cx="5.5" cy="5.5" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="18.5" cy="18.5" r="2" />
      <path d="M7.5 5.5H12a2 2 0 0 1 2 2V10M12 14v2.5a2 2 0 0 0 2 2h2.5" />
    </Icon>
  ),
  mejoras: (
    <Icon>
      <path d="M12 3.5l2.1 5.2 5.4.4-4.1 3.5 1.3 5.3L12 15l-4.7 2.9 1.3-5.3-4.1-3.5 5.4-.4z" />
    </Icon>
  ),
  trafico: (
    <Icon>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </Icon>
  ),
  informes: (
    <Icon>
      <path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5A1.5 1.5 0 0 1 7.5 3.5z" />
      <path d="M13.5 3.5V8H18M9 13h6M9 16.5h6" />
    </Icon>
  ),
} as const;

export function ChevronRight({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}
