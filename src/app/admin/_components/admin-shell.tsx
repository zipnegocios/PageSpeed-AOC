import Link from "next/link";
import type { ReactNode } from "react";
import { getSession } from "@/lib/auth/session";
import { BrandLockup } from "@/lib/ui/components/brand-mark";
import { CopyrightLine } from "@/lib/ui/components/copyright-line";
import { PageTitle } from "@/lib/ui/components/page-title";
import { ProfileMenu } from "@/lib/ui/components/profile-menu";
import { avatarUrl } from "@/lib/ui/components/avatar";
import { displayName, initials } from "@/server/domain/profile";
import { AdminNav } from "./admin-nav";
import { AlertBellLoader } from "./alert-bell-loader";
import { ProjectSwitcherLoader } from "./project-switcher-loader";

export type Crumb = { label: string; href?: string };

/** Marco común de las pantallas de administración: navegación, sesión y título. */
export async function AdminShell({
  title,
  subtitle,
  crumbs = [],
  actions,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  crumbs?: Crumb[];
  actions?: ReactNode;
  children: ReactNode;
}) {
  // La persona de la barra (menú de perfil): la sesión ya se leyó en la página y aquí sale de la caché de la petición.
  const session = await getSession();
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-7xl flex-col gap-6 px-4 pb-10 md:px-8">
      <header className="hud z-30 mt-3 md:sticky md:top-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg px-3 py-2">
        <nav aria-label="Principal" className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link href="/admin" className="press mr-2 inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-[13px] font-bold tracking-[0.08em] text-ink uppercase">
            <BrandLockup wordClassName="text-[13px] tracking-[0.08em]" />
          </Link>
          <AdminNav />
        </nav>
        <div className="flex items-center gap-2">
          <ProjectSwitcherLoader />
          <AlertBellLoader />
          {session ? (
            <ProfileMenu
              name={displayName(session)}
              email={session.email}
             
              role={session.role}
              initials={initials(session)}
              avatarSrc={avatarUrl(session.id, session.avatarKey)}
            />
          ) : null}
        </div>
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
            <PageTitle>{title}</PageTitle>
            {subtitle ? <div className="text-ink-muted">{subtitle}</div> : null}
          </div>
          {actions}
        </div>
      </div>

      <main className="flex flex-col gap-6">{children}</main>
      <footer className="mt-auto border-t border-border pt-4">
        <CopyrightLine />
      </footer>
    </div>
  );
}
