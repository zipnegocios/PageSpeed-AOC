import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { lightToken } from "@/lib/tokens";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  return {
    // Cada cliente instala su propio portal: el manifiesto lleva su enlace.
    manifest: `/c/${token}/manifest.webmanifest`,
    icons: { icon: "/pwa/icon-192.png", apple: "/pwa/apple-touch-icon.png" },
    appleWebApp: { capable: true, title: "Tu informe", statusBarStyle: "default" },
  };
}

export const viewport: Viewport = { themeColor: lightToken("brand-deep") };

export default function PortalLayout({ children }: { children: ReactNode }) {
  return children;
}
