import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/lib/ui/components/button";
import { logoutAction } from "../actions";

export type Crumb = { label: string; href?: string };

/** Marco común de las pantallas de administración: navegación, sesión y título. */
export function AdminShell({
  email,
  title,
  subtitle,
  crumbs = [],
  actions,
  children,
}: {
  email: string;
  title: string;
  subtitle?: ReactNode;
  crumbs?: Crumb[];
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <nav aria-label="Principal" className="flex items-center gap-5">
          <Link href="/admin" className="text-[13px] font-bold uppercase tracking-[0.08em] text-ink">
            AOC PageSpeed
          </Link>
          <Link href="/admin/clientes" className="text-[17px] font-semibold text-link hover:underline">
            Clientes
          </Link>
        </nav>
        <form action={logoutAction} className="flex items-center gap-3">
          <span className="hidden text-[15px] text-ink-muted sm:inline">{email}</span>
          <Button type="submit" variant="secondary">
            Salir
          </Button>
        </form>
      </header>

      <div className="flex flex-col gap-2">
        {crumbs.length > 0 ? (
          <nav aria-label="Ruta de navegación" className="flex flex-wrap gap-2 text-[15px] text-ink-muted">
            {crumbs.map((c, i) => (
              <span key={`${c.label}-${i}`} className="flex gap-2">
                {c.href ? (
                  <Link href={c.href} className="text-link hover:underline">
                    {c.label}
                  </Link>
                ) : (
                  <span>{c.label}</span>
                )}
                <span aria-hidden="true">/</span>
              </span>
            ))}
          </nav>
        ) : null}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="text-[32px] leading-9 font-bold break-words text-ink">{title}</h1>
            {subtitle ? <div className="text-ink-muted">{subtitle}</div> : null}
          </div>
          {actions}
        </div>
      </div>

      <main className="flex flex-col gap-6">{children}</main>
    </div>
  );
}
