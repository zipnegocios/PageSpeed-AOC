import { getSession } from "@/lib/auth/session";
import { isUuid } from "@/server/services/shared";
import { readAvatar } from "@/server/services/profile";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * La foto de un administrador. Solo para quien tiene sesión de administrador: nada es público. La clave del objeto
 * cambia en cada subida y la URL lleva `?v=…`, así que el navegador puede guardarla "para siempre".
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!(await getSession())) return new Response(null, { status: 401 });
  const { id } = await ctx.params;
  if (!isUuid(id)) return new Response(null, { status: 404 });
  const avatar = await readAvatar(id).catch(() => null);
  if (!avatar) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(avatar.bytes), {
    headers: {
      "Content-Type": avatar.contentType,
      "Content-Length": String(avatar.bytes.byteLength),
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
