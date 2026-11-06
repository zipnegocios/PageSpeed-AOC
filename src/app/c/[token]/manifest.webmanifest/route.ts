import { darkToken } from "@/lib/tokens";
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

  // Sin sesión de PIN no se revela el nombre del cliente.
  const clientName = access.state === "ok" ? access.client.name : access.state === "suspended" ? access.clientName : "tu informe";
  const body = {
    id: `/c/${token}`,
    name: `Informe de ${clientName}`.slice(0, 45),
    short_name: short(clientName),
    description: "Estado y evolución de las auditorías de tu sitio.",
    lang: "es",
    start_url: `/c/${token}`,
    scope: `/c/${token}`,
    display: "standalone",
    orientation: "portrait",
    background_color: darkToken("space"),
    theme_color: darkToken("space"),
    icons: [
      { src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "private, no-store" },
  });
}
