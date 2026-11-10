import { getSession } from "@/lib/auth/session";
import { isLogoKind } from "@/server/domain/client-logo";
import { readClientLogo } from "@/server/services/client-logo";
import { isUuid } from "@/server/services/shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** El logotipo de un cliente para el panel (`?k=icon|full`). Solo con sesión de administrador; `?v=` lo versiona. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!(await getSession())) return new Response(null, { status: 401 });
  const { id } = await ctx.params;
  const kind = new URL(req.url).searchParams.get("k");
  if (!isUuid(id) || !isLogoKind(kind)) return new Response(null, { status: 404 });
  const logo = await readClientLogo(id, kind).catch(() => null);
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
