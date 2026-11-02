import { z } from "zod";

/** Los formularios envían "" para los campos vacíos: se trata igual que ausente. */
export const optionalText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().max(max, { error: `Máximo ${max} caracteres.` }).optional(),
  );

export const requiredText = (label: string, min: number, max: number) =>
  z
    .string({ error: `${label} es obligatorio.` })
    .trim()
    .min(min, { error: `${label} necesita al menos ${min} caracteres.` })
    .max(max, { error: `${label} admite como máximo ${max} caracteres.` });

/** Recorta espacios y trata "" como ausente, antes de validar. */
const blankToUndefined = (v: unknown) => {
  if (typeof v !== "string") return v;
  const trimmed = v.trim();
  return trimmed === "" ? undefined : trimmed;
};

export const optionalEmail = z.preprocess(
  blankToUndefined,
  z.email({ error: "El correo no es válido." }).optional(),
);

export const optionalPhone = z.preprocess(
  blankToUndefined,
  z
    .string()
    .trim()
    .regex(/^\+?[\d\s().-]{6,30}$/, { error: "El teléfono no es válido. Usa dígitos y, si quieres, el prefijo +." })
    .optional(),
);

export const uuid = z.uuid({ error: "Identificador no válido." });

/** Primer mensaje de error legible de un resultado de zod. */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Revisa los datos.";
}
