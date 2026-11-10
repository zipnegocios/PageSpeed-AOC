import Link from "next/link";
import type { ReactNode } from "react";
import { BRAND_NAME } from "@/lib/brand";
import { BrandGlyph } from "@/lib/ui/components/brand-mark";
import { ClientLogo } from "@/lib/ui/components/client-logo";
import { CopyrightLine } from "@/lib/ui/components/copyright-line";
import { PortalTabs, type PortalTabId } from "./portal-tabs";

/**
 * Marco persistente del informe de un proyecto: barra superior (con las pestañas en escritorio), contenido a todo el
 * ancho y barra de pestañas fija abajo en el teléfono. Vive en el layout del proyecto, así que al cambiar de pestaña
 * solo se vuelve a pedir el contenido y el marco no parpadea.
 */
export function PortalChrome({
  token,
  base,
  clientName,
  logo,
  projectName,
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
  several: boolean;
  badges: Partial<Record<PortalTabId, number>>;
  children: ReactNode;
}) {
  return (
    <div className="portal min-h-dvh" data-theme="light">
      <header className="portal-topbar sticky top-0 z-40">
        <div className="mx-auto flex h-12 w-full max-w-[1920px] items-center gap-4 px-4 md:h-14 md:px-8">
          <p className="flex min-w-0 items-center gap-2 text-[15px] font-semibold text-ink">
            {logo ? <ClientLogo src={logo.src} bg={logo.bg} name={clientName} className="size-8 rounded-lg" /> : <BrandGlyph className="h-5" />}
            <span className="truncate">{clientName}</span>
            <span className="hidden truncate font-normal text-ink-muted md:inline">· {projectName}</span>
          </p>
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
      <div className="mx-auto w-full max-w-[1920px] px-4 md:px-8">
        <main className="portal-main flex flex-col gap-5 pt-2 md:pt-6">{children}</main>
        <footer className="hidden flex-wrap items-center justify-between gap-2 border-t border-border py-4 text-[13px] text-ink-muted md:flex">
          <span>Informe generado por {BRAND_NAME}</span>
          <CopyrightLine />
        </footer>
      </div>
      <PortalTabs base={base} variant="bottom" badges={badges} />
    </div>
  );
}
