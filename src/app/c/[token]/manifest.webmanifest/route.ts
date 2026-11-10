import { pwaIconUrl } from "@/lib/auth/pwa-icon";
import { PWA_TITLE } from "@/lib/brand";
import { lightToken } from "@/lib/tokens";
import { checkPortal } from "../../_lib/access";

export const dynamic = "force-dynamic";

/** Nombre corto para el icono de la pantalla de inicio (los sistemas lo recortan hacia los 12 caracteres). */
const short = (s: string) => (s.length <= 12 ? s : `${s.slice(0, 11).trimEnd()}…`);

/**
 * Manifiesto de la app instalable de un cliente. Abre su propio portal (el token va en la ruta, así
 * que cada cliente instala su enlace) y no declara service worker: no hay modo sin conexión.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const access = await checkPortal(token);
  if (access.state === "blocked") return new Response("Demasiados intentos", { status: 429 });
  if (access.state === "invalid" || access.state === "legacy") return new Response("Enlace no válido", { status: 404 });

  // Sin sesión de PIN no se revela el nombre del cliente (ni su logotipo). El navegador pide el manifiesto con cookies
  // solo si el enlace lo marca `crossorigin="use-credentials"` (lo hace el layout del portal).
  const client = access.state === "ok" ? access.client : null;
  const clientName = client?.name ?? (access.state === "suspended" ? access.clientName : null);
  const logo = client?.logo;
  const icons = logo
    ? [192, 512].map((s) => ({ src: pwaIconUrl(token, s, logo.v), sizes: `${s}x${s}`, type: "image/png", purpose: "any" }))
    : [
        { src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
        { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ];
  const body = {
    id: `/c/${token}`,
    name: (clientName ? `${PWA_TITLE} - ${clientName}` : PWA_TITLE).slice(0, 60),
    short_name: short(clientName ?? "Informes"),
    description: "Estado y evolución de las auditorías de tu sitio.",
    lang: "es",
    start_url: `/c/${token}`,
    scope: `/c/${token}`,
    display: "standalone",
    orientation: "portrait",
    background_color: lightToken("surface-100"),
    theme_color: lightToken("surface-200"),
    icons,
  };
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "private, no-store" },
  });
}
