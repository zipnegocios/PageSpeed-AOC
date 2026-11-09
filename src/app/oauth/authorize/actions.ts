"use server";

import { redirect } from "next/navigation";
import { field, guarded, type ActionState } from "@/lib/actions";
import { verifySession } from "@/lib/auth/session";
import { authorize, denyRedirect, validateAuthorizeRequest } from "@/server/services/oauth";

/**
 * Autoriza la conexión: revalida la solicitud (la query viaja de vuelta como texto, no se confía en lo que trae el
 * formulario), crea el código con lo elegido y devuelve a la persona a la aplicación.
 */
export async function authorizeAction(query: Record<string, string>, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await verifySession();
  return guarded(async () => {
    const request = await validateAuthorizeRequest(query);
    const target = await authorize(
      session,
      request,
      {
        preset: field(fd, "preset"),
        access: field(fd, "access"),
        clientIds: fd.getAll("clientIds").map(String),
        projectIds: fd.getAll("projectIds").map(String),
      },
    );
    redirect(target);
  });
}

export async function denyAction(query: Record<string, string>): Promise<void> {
  await verifySession();
  const request = await validateAuthorizeRequest(query);
  redirect(denyRedirect(request));
}
