import { z } from "zod";
import { DomainError } from "@/server/domain/errors";
import { slugify } from "@/server/domain/slug";
import { firstIssue } from "@/server/validation/common";

/** Valida con zod y convierte el primer problema en un DomainError legible. */
export function parseInput<S extends z.ZodType>(schema: S, raw: unknown): z.infer<S> {
  const result = schema.safeParse(raw);
  if (!result.success) throw new DomainError("INVALID", firstIssue(result.error));
  return result.data;
}

export function assertUuid(id: string, what: string): void {
  if (!z.uuid().safeParse(id).success) throw new DomainError("NOT_FOUND", `${what} no encontrado.`);
}

/** Código SQLSTATE de un error de Postgres (drizzle lo envuelve en `cause`). */
export function pgErrorCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  const code = e?.cause?.code ?? e?.code;
  return typeof code === "string" ? code : undefined;
}

export function isUniqueViolation(err: unknown): boolean {
  return pgErrorCode(err) === "23505";
}

/** Elige `base`, `base-2`, `base-3`... hasta encontrar un identificador libre. */
export async function uniqueSlug(name: string, taken: (slug: string) => Promise<boolean>): Promise<string> {
  const base = slugify(name);
  if (!base) throw new DomainError("INVALID", "El nombre debe incluir letras o números.");
  for (let i = 1; i <= 50; i++) {
    const candidate = i === 1 ? base : `${base.slice(0, 36)}-${i}`;
    if (!(await taken(candidate))) return candidate;
  }
  throw new DomainError("CONFLICT", "No se encontró un identificador libre; indica uno manualmente.");
}
