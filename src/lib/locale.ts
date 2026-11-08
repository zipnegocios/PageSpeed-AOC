import { cookies } from "next/headers";
import { parseLocale, type UiLocale } from "@/server/report/lighthouse-report";

export const LOCALE_COOKIE = "pagespeed_lang";

/** Idioma de los textos de Lighthouse: el de la cookie, o español por defecto. */
export async function getLocale(): Promise<UiLocale> {
  return parseLocale((await cookies()).get(LOCALE_COOKIE)?.value);
}
