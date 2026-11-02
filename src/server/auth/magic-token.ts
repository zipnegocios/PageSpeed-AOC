import { randomBytes } from "node:crypto";

/** 32 bytes aleatorios en base64url (43 caracteres). Es un secreto: quien lo tiene ve el portal. */
export function generateMagicToken(): string {
  return randomBytes(32).toString("base64url");
}
