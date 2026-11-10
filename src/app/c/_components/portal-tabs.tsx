"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { cx } from "@/lib/ui/cx";
import { TabIcon } from "./portal-icons";

export const PORTAL_TABS = [
  { id: "resumen", segment: null, label: "Resumen" },
  { id: "rutas", segment: "rutas", label: "Rutas" },
  { id: "mejoras", segment: "mejoras", label: "Mejoras" },
  { id: "trafico", segment: "trafico", label: "Tráfico" },
  { id: "informes", segment: "informes", label: "Informes" },
] as const;

export type PortalTabId = (typeof PORTAL_TABS)[number]["id"];

/** La pestaña activa según el tramo de la dirección. El detalle de ingeniería cuelga de «Rutas». */
function activeTab(segment: string | null): PortalTabId {
  if (segment === "detalle") return "rutas";
  return PORTAL_TABS.find((t) => t.segment === segment)?.id ?? "resumen";
}

/**
 * Pestañas del portal. `bottom` es la barra fija del teléfono (icono y texto, con el área segura de iOS) y `top` la
 * fila de la barra superior en escritorio. Es el único trozo de la navegación que corre en el navegador: marca la
 * activa sin volver a pedir el marco al servidor.
 */
export function PortalTabs({ base, variant, badges = {} }: { base: string; variant: "top" | "bottom"; badges?: Partial<Record<PortalTabId, number>> }) {
  const current = activeTab(useSelectedLayoutSegment());
  const label = "Secciones del informe";
  if (variant === "bottom") {
    return (
      <nav aria-label={label} className="portal-tabbar fixed inset-x-0 bottom-0 z-40 md:hidden">
        <ul className="mx-auto flex max-w-xl">
          {PORTAL_TABS.map((t) => {
            const on = current === t.id;
            const badge = badges[t.id];
            return (
              <li key={t.id} className="min-w-0 flex-1">
                <Link
                  href={t.segment ? `${base}/${t.segment}` : base}
                  aria-current={on ? "page" : undefined}
                  className={cx("press relative flex h-[var(--tabbar-h)] flex-col items-center justify-center gap-0.5 text-[10.5px] leading-3 font-medium", on ? "text-primary" : "text-ink-muted")}
                >
                  <span className="relative">
                    <TabIcon id={t.id} active={on} />
                    {badge ? (
                      <span className="absolute -top-1 -right-2.5 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] leading-4 font-semibold text-white tabular-nums">{badge}</span>
                    ) : null}
                  </span>
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }
  return (
    <nav aria-label={label} className="hidden md:block">
      <ul className="flex items-center gap-1">
        {PORTAL_TABS.map((t) => {
          const on = current === t.id;
          const badge = badges[t.id];
          return (
            <li key={t.id}>
              <Link
                href={t.segment ? `${base}/${t.segment}` : base}
                aria-current={on ? "page" : undefined}
                className={cx("press inline-flex min-h-10 items-center gap-2 rounded-full py-0 pr-4 pl-3 text-[15px] font-semibold", on ? "bg-primary-subtle text-on-primary-subtle" : "text-ink-muted hover:bg-surface-300")}
              >
                <TabIcon id={t.id} active={on} size={20} />
                {t.label}
                {badge ? <span className="min-w-5 rounded-full bg-danger px-1.5 text-center text-[12px] leading-5 font-semibold text-white tabular-nums">{badge}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
