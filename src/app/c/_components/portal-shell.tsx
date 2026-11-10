import type { ReactNode } from "react";
import { BRAND_NAME } from "@/lib/brand";
import { BrandGlyph } from "@/lib/ui/components/brand-mark";
import { CopyrightLine } from "@/lib/ui/components/copyright-line";

/**
 * Marco sencillo del portal para las pantallas sin informe: PIN, avisos, enlace no válido, invitación al panel. Mismo
 * estilo de app de iPhone que el informe, en una columna centrada. El informe de un proyecto usa `PortalChrome`.
 */
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
    <div className="portal min-h-dvh" data-theme="light">
      <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-5 px-4 py-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] md:px-8 md:py-10">
        <header className="flex flex-col gap-3">
          <p className="flex items-center gap-2 text-[15px] font-semibold text-ink-muted">
            <BrandGlyph className="h-5" />
            {clientName ?? BRAND_NAME}
          </p>
          <h1 className="text-[32px] leading-9 font-bold tracking-[-0.022em] text-ink md:text-[40px] md:leading-[44px]">{title}</h1>
          {subtitle ? <div className="text-[17px] leading-6 text-ink-muted">{subtitle}</div> : null}
        </header>
        <main className="flex flex-col gap-5">{children}</main>
        <footer className="mt-auto flex flex-col gap-1 border-t border-border pt-4 text-[13px] text-ink-muted">
          {plainFooter ? null : <span>Informe generado por {BRAND_NAME}</span>}
          <CopyrightLine />
        </footer>
      </div>
    </div>
  );
}
