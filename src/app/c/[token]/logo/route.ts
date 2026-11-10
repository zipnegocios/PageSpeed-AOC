import { isLogoKind } from "@/server/domain/client-logo";
import { readClientLogo } from "@/server/services/client-logo";
import { checkPortal } from "../../_lib/access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * El logotipo del cliente para su portal (`?k=icon|full`). Solo con el acceso concedido (PIN válido): en la pantalla del
 * PIN, un bloqueo o un enlace inexistente responde 404 igual, para no revelar qué clientes existen ni cómo se llaman.
 * `?v=` cambia con cada logotipo nuevo, así que el navegador puede guardarlo.
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const access = await checkPortal(token);
  if (access.state !== "ok") return new Response(null, { status: 404 });
  const kind = new URL(req.url).searchParams.get("k");
  if (!isLogoKind(kind)) return new Response(null, { status: 404 });
  const logo = await readClientLogo(access.client.id, kind).catch(() => null);
  if (!logo) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(logo.bytes), {
    headers: {
      "Content-Type": logo.contentType,
      "Content-Length": String(logo.bytes.byteLength),
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
