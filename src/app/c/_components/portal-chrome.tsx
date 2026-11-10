import Link from "next/link";
import type { ReactNode } from "react";
import { BRAND_NAME } from "@/lib/brand";
import { BrandGlyph, BrandLockup } from "@/lib/ui/components/brand-mark";
import { Badge } from "@/lib/ui/components/badge";
import { ClientLogo } from "@/lib/ui/components/client-logo";
import { CopyrightLine } from "@/lib/ui/components/copyright-line";
import { PortalTabs, type PortalTabId } from "./portal-tabs";

/**
 * Marco persistente del informe de un proyecto: barra superior (con las pestañas en escritorio), contenido a todo el
 * ancho, pie siempre abajo del todo y barra de pestañas fija abajo en el teléfono. La marca de PageSpeed va siempre antes que la del
 * cliente: el logotipo completo en escritorio y solo el isotipo en el teléfono. Vive en el layout del proyecto, así que al cambiar de pestaña
 * solo se vuelve a pedir el contenido y el marco no parpadea.
 */
export function PortalChrome({
  token,
  base,
  clientName,
  logo,
  projectName,
  phase,
  several,
  badges,
  children,
}: {
  token: string;
  base: string;
  clientName: string;
  /** Logotipo pequeño de la barra (isotipo, o el completo a falta de él) y su fondo; null = sin logotipo. */
  logo: { src: string; bg: string | null } | null;
  projectName: string;
  /** En qué fase está el proyecto: el cliente ve también los que están en desarrollo. */
  phase?: "development" | "production";
  several: boolean;
  badges: Partial<Record<PortalTabId, number>>;
  children: ReactNode;
}) {
  return (
    <div className="portal flex min-h-dvh flex-col" data-theme="light">
      <header className="portal-topbar sticky top-0 z-40">
        <div className="mx-auto flex h-12 w-full max-w-[1920px] items-center gap-4 px-4 md:h-14 md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            {/* La marca de PageSpeed, siempre primero: el logotipo completo en escritorio y solo el isotipo en el teléfono. */}
            <span className="hidden shrink-0 md:inline-flex">
              <BrandLockup wordClassName="whitespace-nowrap" />
            </span>
            <span className="shrink-0 md:hidden">
              <BrandGlyph className="h-6" title="PageSpeed" />
            </span>
            <span aria-hidden className="h-6 w-px shrink-0 bg-border-strong/50" />
            <p className="flex min-w-0 items-center gap-2 text-[15px] font-semibold text-ink">
              {logo ? <ClientLogo src={logo.src} bg={logo.bg} name={clientName} className="size-8 rounded-lg" /> : null}
              <span className="truncate">{clientName}</span>
              <span className="hidden truncate font-normal text-ink-muted md:inline">· {projectName}</span>
              {phase ? (
                <span className="hidden md:inline-flex">
                  <Badge tone={phase === "production" ? "ok" : "warning"}>{phase === "production" ? "En producción" : "En desarrollo"}</Badge>
                </span>
              ) : null}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-4">
            <PortalTabs base={base} variant="top" badges={badges} />
            {several ? (
              <Link href={`/c/${token}`} className="press inline-flex min-h-10 items-center text-[15px] font-semibold text-link">
                Proyectos
              </Link>
            ) : null}
          </div>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-[1920px] flex-1 flex-col px-4 md:px-8">
        <main className="portal-main flex flex-1 flex-col gap-5 pt-2 md:pt-6">{children}</main>
        <footer className="portal-footer flex flex-col gap-1 border-t border-border pt-4 text-[13px] text-ink-muted md:flex-row md:flex-wrap md:items-center md:justify-between md:gap-2">
          <span>Informe generado por {BRAND_NAME}</span>
          <CopyrightLine />
        </footer>
      </div>
      <PortalTabs base={base} variant="bottom" badges={badges} />
    </div>
  );
}
