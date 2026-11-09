"use server";

import { revalidatePath } from "next/cache";
import { field, guarded, type ActionState } from "@/lib/actions";
import { verifySession } from "@/lib/auth/session";
import { inviteMember, removeMember, resendInvite, revokeInvite, sendPasswordReset, type IssueResult } from "@/server/services/team";

/** Mensaje y enlace de lo enviado: el enlace sale como secreto (se muestra una sola vez) por si el correo no llega. */
function sent(r: IssueResult, what: string): ActionState {
  return {
    ok: r.emailed ? `${what} Enviamos el correo a ${r.to}.` : `${what} No se pudo enviar el correo (${r.emailError}). Comparte el enlace de abajo con la persona.`,
    secret: r.link,
  };
}

export async function inviteMemberAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await verifySession();
  return guarded(async () => {
    // La foto llega ya recortada y reducida por el navegador; el servicio la vuelve a validar por firma y tamaño.
    const file = fd.get("avatar");
    const avatar = file instanceof File && file.size > 0 ? new Uint8Array(await file.arrayBuffer()) : null;
    const r = await inviteMember(
      session,
      { email: field(fd, "email"), firstName: field(fd, "firstName"), lastName: field(fd, "lastName"), access: field(fd, "access") || "email", password: field(fd, "password") },
      undefined,
      undefined,
      avatar,
    );
    revalidatePath("/admin/equipo");
    if (r.mode === "password") {
      return {
        ok: `Cuenta creada para ${r.to}. Entra en ${r.loginUrl} con su correo y esta contraseña provisional (se muestra una sola vez); podrá cambiarla en su perfil.`,
        secret: r.password,
      };
    }
    return sent(r, "Invitación creada.");
  });
}

export async function resendInviteAction(inviteId: string, _prev: ActionState): Promise<ActionState> {
  const session = await verifySession();
  return guarded(async () => {
    const r = await resendInvite(session, inviteId);
    revalidatePath("/admin/equipo");
    return sent(r, "Enlace nuevo creado; el anterior ya no sirve.");
  });
}

export async function sendResetAction(userId: string, _prev: ActionState): Promise<ActionState> {
  const session = await verifySession();
  return guarded(async () => {
    const r = await sendPasswordReset(session, userId);
    revalidatePath("/admin/equipo");
    return sent(r, "Enlace de contraseña nueva creado.");
  });
}

export async function revokeInviteAction(inviteId: string, _prev: ActionState): Promise<ActionState> {
  const session = await verifySession();
  return guarded(async () => {
    await revokeInvite(session, inviteId);
    revalidatePath("/admin/equipo");
    return { ok: "Invitación revocada. Su enlace ya no sirve." };
  });
}

export async function removeMemberAction(userId: string, _prev: ActionState): Promise<ActionState> {
  const session = await verifySession();
  return guarded(async () => {
    await removeMember(session, userId);
    revalidatePath("/admin/equipo");
    return { ok: "Persona quitada del equipo. Su sesión deja de valer." };
  });
}
