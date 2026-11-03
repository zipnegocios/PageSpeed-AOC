import { SegmentedNav } from "./segmented-nav";

/** Español / English para los textos de Lighthouse. Recuerda la elección en una cookie y vuelve a `returnTo`. */
export function LanguageSwitch({ locale, returnTo }: { locale: "es" | "en"; returnTo: string }) {
  const href = (l: string) => `/api/lang?set=${l}&back=${encodeURIComponent(returnTo)}`;
  return (
    <SegmentedNav
      label="Idioma de los textos de Lighthouse"
      items={[
        { label: "Español", href: href("es"), current: locale === "es", plain: true },
        { label: "English", href: href("en"), current: locale === "en", plain: true },
      ]}
    />
  );
}
