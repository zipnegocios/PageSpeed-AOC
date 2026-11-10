import { createElement } from "react";
import { ImageResponse } from "next/og";
import { isValidPwaIcon } from "@/lib/auth/pwa-icon";
import { LOGO_BOLT_PATH, LOGO_GLYPH_VIEWBOX } from "@/lib/brand";
import { isValidSlug } from "@/server/domain/slug";
import { readPwaIconSource } from "@/server/services/client-logo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SIZES = new Set([180, 192, 512]);

/**
 * Icono de la app instalada de un cliente: su isotipo (o, a falta de él, su logotipo completo) sobre su color de fondo,
 * con el rayo de PageSpeed en una insignia abajo a la derecha, para distinguir de un vistazo que es el acceso de la
 * plataforma y no una aplicación del propio cliente. Sin logotipo, responde con el icono de PageSpeed de siempre.
 *
 * El navegador lo pide sin cookies: la dirección lleva una firma que solo emite el manifiesto (que sí exige el PIN).
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string; size: string }> }): Promise<Response> {
  const { token, size: rawSize } = await params;
  const size = Number(rawSize.replace(/\.png$/, ""));
  const url = new URL(req.url);
  if (!SIZES.has(size) || !isValidSlug(token) || !isValidPwaIcon(token, url.searchParams.get("v") ?? "", url.searchParams.get("s") ?? "")) {
    return new Response(null, { status: 404 });
  }
  const fallback = () => Response.redirect(new URL(size === 180 ? "/pwa/apple-touch-icon.png" : `/pwa/icon-${size}.png`, req.url), 307);
  const source = await readPwaIconSource(token).catch(() => null);
  if (!source) return fallback();

  const src = `data:image/png;base64,${source.bytes.toString("base64")}`;
  const bg = source.bg ?? "#FFFFFF";
  const badge = Math.round(size * 0.34);
  const inset = Math.round(size * 0.05);
  const art = Math.round(size * 0.62);
  const h = createElement;
  const tree = h(
    "div",
    { style: { width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", position: "relative", background: bg } },
    h("img", { src, width: art, height: art, style: { width: art, height: art, objectFit: "contain" } }),
    h(
      "div",
      { style: { position: "absolute", right: inset, bottom: inset, width: badge, height: badge, borderRadius: badge, background: "#111827", display: "flex", alignItems: "center", justifyContent: "center" } },
      h("svg", { width: Math.round(badge * 0.56), height: Math.round(badge * 0.56), viewBox: LOGO_GLYPH_VIEWBOX }, h("path", { d: LOGO_BOLT_PATH, fill: "#A3E635" })),
    ),
  );
  const res = new ImageResponse(tree, { width: size, height: size });
  res.headers.set("Cache-Control", "private, max-age=86400");
  return res;
}
