"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { clientIp } from "@/lib/auth/client-ip";
import { createSession } from "@/lib/auth/session";
import { loginLimiters } from "@/lib/auth/login-limiter";
import { safeNext } from "@/lib/auth/safe-next";
import { authenticate, normalizeEmail } from "@/server/services/admin-auth";

// `email` se devuelve en los errores: React vacía el formulario tras cada envío y así el correo no se pierde.
export type LoginState = { error?: string; email?: string };

const schema = z.object({
  email: z.email({ error: "Escribe un correo válido." }),
  password: z.string().min(1, { error: "Escribe tu contraseña." }).max(200),
});

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const parsed = schema.safeParse({ email, password: String(formData.get("password") ?? "") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisa los datos.", email };
  }

  const ip = await clientIp();
  const accountKey = `${ip}|${normalizeEmail(parsed.data.email)}`;
  const { perAccount, perIp } = loginLimiters;
  if (perAccount.isBlocked(accountKey) || perIp.isBlocked(ip)) {
    const minutes = Math.ceil(Math.max(perAccount.retryAfterSeconds(accountKey), perIp.retryAfterSeconds(ip)) / 60);
    return { error: `Demasiados intentos. Vuelve a intentarlo en ${minutes} min.`, email };
  }

  const result = await authenticate(parsed.data.email, parsed.data.password);
  if (!result.ok) {
    perAccount.recordFailure(accountKey);
    perIp.recordFailure(ip);
    return { error: "Correo o contraseña incorrectos.", email };
  }

  perAccount.reset(accountKey);
  await createSession(result.admin);
  redirect(safeNext(String(formData.get("next") ?? "")) ?? "/admin");
}
