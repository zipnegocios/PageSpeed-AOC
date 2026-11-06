import type { ReactNode } from "react";

/** Marco público del portal: sin navegación de administración ni controles de sesión. Mismo tema espacial que el panel. */
export function PortalShell({ clientName, title, subtitle, children }: { clientName?: string; title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
      <header className="glass rise flex flex-col gap-1 rounded-lg px-4 py-4 md:px-6">
        <p className="flex items-center gap-2 text-[13px] font-bold tracking-[0.08em] text-ink-muted uppercase">
          <svg viewBox="0 0 24 24" className="size-5 text-primary" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden style={{ filter: "drop-shadow(0 0 4px var(--primary))" }}>
            <path d="M5.6 18.4a9 9 0 1 1 12.8 0" />
            <path d="m12 13 4-4" />
          </svg>
          {clientName ?? "AOC PageSpeed"}
        </p>
        <h1 className="text-[32px] leading-9 font-bold tracking-[-0.02em] text-ink">{title}</h1>
        {subtitle ? <div className="text-[17px] text-ink-muted">{subtitle}</div> : null}
      </header>
      <main className="flex flex-col gap-6">{children}</main>
      <footer className="mt-auto border-t border-border pt-4 text-[14px] text-ink-muted">Informe generado por AOC PageSpeed</footer>
    </div>
  );
}
