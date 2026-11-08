import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { readSessionToken, signSessionToken } from "@/server/auth/session-token";
import { resolveSession, type AdminSummary } from "@/server/services/admin-auth";

export const SESSION_COOKIE = "pagespeed_session";

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error("SESSION_SECRET no está definida o tiene menos de 32 caracteres");
  }
  return value;
}

export async function createSession(admin: AdminSummary): Promise<void> {
  const { token, expiresAt } = await signSessionToken(
    { sub: admin.id, email: admin.email, pv: admin.pv },
    secret(),
  );
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function deleteSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** Sesión actual o null. Valida la firma y que el admin siga existiendo (una vez por petición). */
export const getSession = cache(async (): Promise<AdminSummary | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const claims = await readSessionToken(token, secret());
  if (!claims) return null;
  return resolveSession(claims);
});

/**
 * Úsala en cada página, acción y route handler de administración, junto al dato que protege.
 * No basta con comprobar en el layout: el layout no se vuelve a ejecutar al navegar.
 */
export async function verifySession(): Promise<AdminSummary> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}
