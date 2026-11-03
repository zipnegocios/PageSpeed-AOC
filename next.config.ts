import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // react-pdf se carga como paquete de Node (no se empaqueta) y las fuentes del informe viajan en la imagen.
  serverExternalPackages: ["@react-pdf/renderer"],
  outputFileTracingIncludes: {
    "/api/admin/projects/[id]/report": ["./src/assets/fonts/**"],
    "/c/[token]/[projectId]/informe": ["./src/assets/fonts/**"],
  },
  async headers() {
    return [
      {
        // Cabeceras de seguridad de toda la aplicación. El portal (más abajo) refuerza Referrer-Policy.
        // Sin CSP por ahora: Next inyecta scripts en línea y un CSP útil necesita nonces por petición.
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
      {
        // El portal lleva el secreto en la URL: nada de indexarlo, cachearlo ni filtrarlo por Referer.
        source: "/c/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
