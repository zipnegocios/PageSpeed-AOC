"use client";

import { usePathname } from "next/navigation";
import { Menu, MenuDivider, MenuLink } from "./menu";

export type BellAlert = { id: string; href: string; where: string; what: string; since: string };

/** La campana de Alertas: con alertas abiertas muestra su número; al abrirla lista las más recientes. */
export function AlertBell({ count, alerts }: { count: number; alerts: BellAlert[] }) {
  const pathname = usePathname();
  const label = count === 0 ? "Alertas: todo en orden" : `Alertas: ${count} ${count === 1 ? "abierta" : "abiertas"}`;
  return (
    <Menu
      label={label}
      active={pathname === "/admin/alertas" || pathname.startsWith("/admin/alertas/")}
      panelClassName="w-80"
      trigger={
        <span className="relative inline-flex">
          <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9Z" />
            <path d="M10 19a2 2 0 0 0 4 0" />
          </svg>
          {count > 0 ? (
            <span aria-hidden className="absolute -top-2 -right-2.5 inline-flex min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[12px] leading-5 font-bold text-surface-100">
              {count > 9 ? "9+" : count}
            </span>
          ) : null}
        </span>
      }
    >
      <p className="px-4 pt-1 pb-2 text-[13px] font-semibold tracking-[0.08em] text-ink-muted uppercase">Alertas abiertas</p>
      {alerts.length === 0 ? (
        <p className="px-4 pb-2 text-[15px] text-ink-muted">Todo en orden.</p>
      ) : (
        alerts.map((a) => (
          <MenuLink key={a.id} href={a.href} className="flex-col items-start gap-0 py-3">
            <span className="text-[15px] leading-5 text-ink-muted">{a.where}</span>
            <span className="text-[17px] leading-5">{a.what}</span>
            <span className="text-[14px] leading-5 font-medium text-ink-muted">{a.since}</span>
          </MenuLink>
        ))
      )}
      <MenuDivider />
      <MenuLink href="/admin/alertas" current={pathname === "/admin/alertas"}>
        Ver todas las alertas{count > alerts.length ? ` (${count})` : ""}
      </MenuLink>
    </Menu>
  );
}
