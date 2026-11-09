import type { ReactNode } from "react";
import { BRAND_NAME } from "@/lib/brand";
import { BrandGlyph, SpeedTrail } from "@/lib/ui/components/brand-mark";
import { CopyrightLine } from "@/lib/ui/components/copyright-line";
import { PageTitle } from "@/lib/ui/components/page-title";

/** Marco público del portal: sin navegación de administración ni controles de sesión. Mismo estilo HUD que el panel. */
export function PortalShell({
  clientName,
  title,
  subtitle,
  plainFooter = false,
  children,
}: {
  clientName?: string;
  title: string;
  subtitle?: ReactNode;
  /** Pie sin «Informe generado por…»: para páginas que no son un informe (la invitación al panel). */
  plainFooter?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
      <header className="hud hud-brackets rise relative flex flex-col gap-2 rounded-lg px-4 py-4 sm:pr-48 md:px-6 md:pr-48">
        <SpeedTrail className="pointer-events-none absolute top-3 right-4 hidden opacity-70 sm:block" />
        <p className="flex items-center gap-2 text-[13px] font-bold tracking-[0.08em] text-ink-muted uppercase">
          <BrandGlyph className="h-5" />
          {clientName ?? BRAND_NAME}
        </p>
        <PageTitle>{title}</PageTitle>
        {subtitle ? <div className="text-[17px] text-ink-muted">{subtitle}</div> : null}
      </header>
      <main className="flex flex-col gap-6">{children}</main>
      <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4 text-[14px] text-ink-muted">
        {plainFooter ? (
          <CopyrightLine />
        ) : (
          <>
            <span className="flex flex-col gap-1">
              <span>Informe generado por {BRAND_NAME}</span>
              <CopyrightLine />
            </span>
            <span aria-hidden className="font-mono text-[11px] tracking-[0.12em] uppercase">
              PAGESPEED // INFORME
            </span>
          </>
        )}
      </footer>
    </div>
  );
}
