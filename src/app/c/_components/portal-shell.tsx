import type { ReactNode } from "react";

/** Marco público del portal: sin navegación de administración ni controles de sesión. */
export function PortalShell({ clientName, title, subtitle, children }: { clientName?: string; title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
      <header className="flex flex-col gap-1 border-b border-border pb-4">
        <p className="text-[13px] font-bold tracking-[0.08em] text-ink-muted uppercase">{clientName ?? "AOC PageSpeed"}</p>
        <h1 className="text-[32px] leading-9 font-bold text-ink">{title}</h1>
        {subtitle ? <div className="text-[17px] text-ink-muted">{subtitle}</div> : null}
      </header>
      <main className="flex flex-col gap-6">{children}</main>
      <footer className="mt-auto border-t border-border pt-4 text-[14px] text-ink-muted">Informe generado por AOC PageSpeed</footer>
    </div>
  );
}
