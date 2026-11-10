import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { pwaIconUrl } from "@/lib/auth/pwa-icon";
import { PWA_TITLE } from "@/lib/brand";
import { lightToken } from "@/lib/tokens";
import { checkPortal } from "../_lib/access";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  // Con el PIN ya validado, el título y el icono llevan el nombre y el logotipo del cliente; sin él, los genéricos
  // (nada que revele qué clientes existen). La comprobación se comparte con el resto de la petición (`cache`).
  const access = await checkPortal(token);
  const client = access.state === "ok" ? access.client : null;
  const touch = client?.logo ? pwaIconUrl(token, 180, client.logo.v) : "/pwa/apple-touch-icon.png";
  const icon = client?.logo ? pwaIconUrl(token, 192, client.logo.v) : "/pwa/icon-192.png";
  return {
    icons: { icon, apple: touch },
    appleWebApp: { capable: true, title: client ? `${PWA_TITLE} - ${client.name}` : PWA_TITLE, statusBarStyle: "default" },
  };
}

// Portal solo claro: la barra del navegador y los controles nativos también.
export const viewport: Viewport = { colorScheme: "light", themeColor: lightToken("surface-200") };

/**
 * El manifiesto se pide con `crossorigin="use-credentials"`: así el navegador envía la cookie del PIN y el manifiesto
 * puede llevar el nombre y el logotipo del cliente. Con la etiqueta de metadatos de Next no se puede (sin credenciales,
 * el manifiesto salía sin nombre de cliente: «Informe de tu informe»).
 */
export default async function PortalLayout({ children, params }: { children: ReactNode; params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <>
      <link rel="manifest" href={`/c/${token}/manifest.webmanifest`} crossOrigin="use-credentials" />
      {children}
    </>
  );
}
