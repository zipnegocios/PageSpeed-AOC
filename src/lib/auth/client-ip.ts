import { headers } from "next/headers";

/** IP del cliente. Detrás de un único proxy, la última entrada de x-forwarded-for es la que añade el proxy. */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean);
  return forwarded?.at(-1) ?? h.get("x-real-ip") ?? "desconocida";
}
