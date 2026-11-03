import { LOCALE_COOKIE } from "@/lib/locale";
import { parseLocale } from "@/server/report/lighthouse-report";

export const dynamic = "force-dynamic";

/**
 * Recuerda el idioma de los textos de Lighthouse y vuelve a la página de origen (solo rutas internas).
 * La redirección es relativa a propósito: detrás del proxy, el origen que ve el servidor no es el público.
 */
export function GET(req: Request) {
  const url = new URL(req.url);
  const locale = parseLocale(url.searchParams.get("set"));
  const back = url.searchParams.get("back") ?? "/";
  const target = back.startsWith("/") && !back.startsWith("//") && !back.includes("\\") && !/[\r\n]/.test(back) ? back : "/";
  const secure = (req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "")) === "https" ? "; Secure" : "";
  return new Response(null, {
    status: 303,
    headers: {
      Location: target,
      "Set-Cookie": `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax; HttpOnly${secure}`,
      "Cache-Control": "no-store",
    },
  });
}
