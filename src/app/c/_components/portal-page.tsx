import type { ReactNode } from "react";

/** Cabecera de una pantalla del portal: título grande, como las apps de iOS, y su contenido debajo. */
export function PortalPage({ title, subtitle, actions, children }: { title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-[32px] leading-9 font-bold tracking-[-0.022em] text-ink md:text-[40px] md:leading-[44px]">{title}</h1>
          {subtitle ? <div className="text-[15px] leading-5 text-ink-muted md:text-[17px] md:leading-6">{subtitle}</div> : null}
        </div>
        {actions}
      </div>
      {children}
    </>
  );
}
