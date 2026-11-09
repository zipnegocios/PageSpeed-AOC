"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/lib/ui/cx";

const ITEMS = [
  { href: "/admin", label: "Panel", exact: true },
  { href: "/admin/proyectos", label: "Proyectos" },
  { href: "/admin/clientes", label: "Clientes" },
  { href: "/admin/agentes", label: "Agentes" },
  { href: "/admin/cola", label: "Cola" },
] as const;

/** Navegación principal con la sección actual marcada (aria-current). */
export function AdminNav() {
  const pathname = usePathname();
  return (
    <ul className="flex flex-wrap items-center gap-1">
      {ITEMS.map((item) => {
        // /admin/clientes/<cliente>/<proyecto> es una ficha de proyecto: cuenta como "Proyectos", no como "Clientes".
        const isProjectPage = /^\/admin\/clientes\/[^/]+\/[^/]+/.test(pathname);
        const active =
          item.href === "/admin/proyectos"
            ? pathname === item.href || pathname.startsWith(`${item.href}/`) || isProjectPage
            : item.href === "/admin/clientes"
              ? (pathname === item.href || pathname.startsWith(`${item.href}/`)) && !isProjectPage
              : "exact" in item && item.exact
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cx(
                "press inline-flex min-h-11 items-center rounded-md px-3 text-[17px] font-semibold",
                active ? "bg-primary text-on-primary" : "text-ink-muted hover:bg-surface-300 hover:text-ink",
              )}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
