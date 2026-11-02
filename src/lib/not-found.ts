import { notFound, unstable_rethrow } from "next/navigation";
import { isDomainError } from "@/server/domain/errors";

/** Convierte un NOT_FOUND de negocio en la página 404 de Next. Cualquier otro error sigue su curso. */
export async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    unstable_rethrow(err);
    if (isDomainError(err) && err.code === "NOT_FOUND") notFound();
    throw err;
  }
}

/** URL pública del sitio, sin barra final. */
export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}
