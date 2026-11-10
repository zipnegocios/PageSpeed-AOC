"use server";

import { revalidatePath } from "next/cache";
import { field, guarded, type ActionState } from "@/lib/actions";
import { createSession, verifySession } from "@/lib/auth/session";
import { DomainError } from "@/server/domain/errors";
import { changePassword, removeAvatar, setAvatar, updateProfile } from "@/server/services/profile";

export async function updateProfileAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await verifySession();
  return guarded(async () => {
    await updateProfile(session, { firstName: field(fd, "firstName"), lastName: field(fd, "lastName"), phone: field(fd, "phone") });
    revalidatePath("/admin", "layout");
    return { ok: "Datos guardados." };
  });
}

export async function changePasswordAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await verifySession();
  return guarded(async () => {
    const fresh = await changePassword(session, { current: field(fd, "current"), password: field(fd, "password"), confirm: field(fd, "confirm") });
    // La versión de la contraseña cambió: las demás sesiones dejan de valer y esta se renueva para seguir dentro.
    await createSession(fresh);
    return { ok: "Contraseña cambiada. Cerramos tus otras sesiones; esta sigue abierta." };
  });
}

/** La foto llega ya recortada y reducida por el navegador; aquí se vuelve a validar por firma y tamaño. */
export async function uploadAvatarAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const session = await verifySession();
  return guarded(async () => {
    const file = fd.get("avatar");
    if (!(file instanceof File) || file.size === 0) throw new DomainError("INVALID", "Elige una foto.");
    await setAvatar(session, new Uint8Array(await file.arrayBuffer()));
    revalidatePath("/admin", "layout");
    return { ok: "Foto actualizada." };
  });
}

export async function removeAvatarAction(_prev: ActionState): Promise<ActionState> {
  const session = await verifySession();
  return guarded(async () => {
    await removeAvatar(session);
    revalidatePath("/admin", "layout");
    return { ok: "Foto quitada." };
  });
}
