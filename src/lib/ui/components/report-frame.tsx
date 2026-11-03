import { LanguageSwitch } from "./language-switch";

/**
 * Informe oficial de Lighthouse en un marco aislado (`sandbox`, sin acceso a la aplicación). Ocupa el alto de la
 * ventana y se desplaza por dentro; la barra superior trae el selector de idioma y abrirlo en una pestaña.
 */
export function ReportFrame({ src, locale, returnTo, title, hideLanguage = false }: { src: string; locale: "es" | "en"; returnTo: string; title: string; hideLanguage?: boolean }) {
  const url = `${src}${src.includes("?") ? "&" : "?"}lang=${locale}`;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {hideLanguage ? <span /> : <LanguageSwitch locale={locale} returnTo={returnTo} />}
        <a href={url} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center rounded-md border border-border-strong bg-surface-200 px-4 text-[17px] font-semibold text-ink hover:bg-surface-300">
          Abrir en una pestaña
        </a>
      </div>
      <iframe
        title={title}
        src={url}
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        loading="lazy"
        className="h-[calc(100dvh-14rem)] min-h-[32rem] w-full rounded-sm border border-border bg-surface-200"
      />
    </div>
  );
}
