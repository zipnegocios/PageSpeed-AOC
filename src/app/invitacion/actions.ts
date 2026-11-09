"use server";

import { redirect } from "next/navigation";
import { guarded, field, type ActionState } from "@/lib/actions";
import { clientIp } from "@/lib/auth/client-ip";
import { inviteLimiter } from "@/lib/auth/invite-limiter";
import { createSession } from "@/lib/auth/session";
import { isDomainError } from "@/server/domain/errors";
import { acceptInvite } from "@/server/services/team";

/** Usa el enlace: crea la cuenta (o cambia la contraseña), abre sesión y entra al panel. */
export async function acceptInviteAction(token: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const ip = await clientIp();
  if (inviteLimiter.isBlocked(ip)) {
    const minutes = Math.ceil(inviteLimiter.retryAfterSeconds(ip) / 60);
    return { error: `Demasiados intentos. Vuelve a intentarlo en ${minutes} min.` };
  }
  return guarded(async () => {
    let admin;
    try {
      admin = await acceptInvite(token, { password: field(fd, "password"), confirm: field(fd, "confirm") });
    } catch (err) {
      // Un enlace que no sirve cuenta como intento fallido; una contraseña mal escrita, no.
      if (isDomainError(err) && err.code === "NOT_FOUND") inviteLimiter.recordFailure(ip);
      throw err;
    }
    await createSession(admin);
    redirect("/admin");
  });
}
