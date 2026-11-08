import type { Metadata, Viewport } from "next";
import { Rajdhani } from "next/font/google";
import { darkToken } from "@/lib/tokens";
import "./globals.css";

const rajdhani = Rajdhani({
  subsets: ["latin", "latin-ext"],
  weight: ["500", "600", "700"],
  variable: "--font-rajdhani",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AOC PageSpeed",
  description: "Auditorías Lighthouse para los proyectos de tus clientes.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Un solo tema: el espacial, siempre oscuro (también la barra del navegador y los controles nativos).
  colorScheme: "dark",
  themeColor: darkToken("surface-100"),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={rajdhani.variable}>
      <body>{children}</body>
    </html>
  );
}
