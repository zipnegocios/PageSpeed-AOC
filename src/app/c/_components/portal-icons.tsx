import type { ReactNode } from "react";

export type TabIconId = "resumen" | "rutas" | "mejoras" | "trafico" | "informes";

function Svg({ size, on, children }: { size: number; on: boolean; children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth={on ? 1.5 : 1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      {children}
    </svg>
  );
}

/**
 * Iconos de las pestañas del portal: de línea cuando la pestaña está inactiva y rellenos cuando está activa. Decorativos: el texto de la
 * pestaña los nombra. Los mismos en la barra inferior del móvil y en la superior de escritorio.
 */
export function TabIcon({ id, active = false, size = 24 }: { id: TabIconId; active?: boolean; size?: number }) {
  switch (id) {
    case "resumen":
      return (
        <Svg size={size} on={active}>
          <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="2.2" />
          <rect x="13" y="3.5" width="7.5" height="7.5" rx="2.2" />
          <rect x="3.5" y="13" width="7.5" height="7.5" rx="2.2" />
          <rect x="13" y="13" width="7.5" height="7.5" rx="2.2" />
        </Svg>
      );
    case "rutas":
      return (
        <Svg size={size} on={active}>
          <circle cx="5.5" cy="5.5" r="2.3" />
          <circle cx="18.5" cy="5.5" r="2.3" />
          <circle cx="18.5" cy="18.5" r="2.3" />
          <path d="M7.8 5.5h8.4M5.5 7.8v3.2a3 3 0 0 0 3 3h7a3 3 0 0 1 3 3" fill="none" />
        </Svg>
      );
    case "mejoras":
      return (
        <Svg size={size} on={active}>
          <path d="M10.5 3.5l1.9 5.1 5.1 1.9-5.1 1.9-1.9 5.1-1.9-5.1-5.1-1.9 5.1-1.9z" />
          <path d="M18.4 14.6l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8z" />
        </Svg>
      );
    case "trafico":
      return (
        <Svg size={size} on={active}>
          <rect x="3.5" y="12" width="4" height="8.5" rx="1.4" />
          <rect x="10" y="3.5" width="4" height="17" rx="1.4" />
          <rect x="16.5" y="8" width="4" height="12.5" rx="1.4" />
        </Svg>
      );
    case "informes":
      return (
        <Svg size={size} on={active}>
          <path d="M7 3.5h7.2L19 8.3V19a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 6 19V5A1.5 1.5 0 0 1 7.5 3.5z" />
          <path d="M14 3.7V8.5h4.8" fill="none" />
          <path d="M9.5 13h6M9.5 16.5h6" fill="none" />
        </Svg>
      );
  }
}

export function ChevronRight({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}
