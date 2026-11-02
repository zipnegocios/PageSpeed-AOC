import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// scrypt con parámetros OWASP: N=2^14, r=8, p=1 (~16 MB por derivación). Formato almacenado:
//   scrypt$N$r$p$salt(base64)$hash(base64)
const N = 16_384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

function derive(password: string, salt: Buffer, n: number, r: number, p: number, keyLength: number) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, keyLength, { N: n, r, p }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P, KEY_LENGTH);
  return ["scrypt", N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const n = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (![n, r, p].every((v) => Number.isInteger(v) && v > 0)) return false;
  const expected = Buffer.from(hashB64, "base64");
  if (expected.length === 0) return false;
  try {
    const actual = await derive(password, Buffer.from(saltB64, "base64"), n, r, p, expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;
/**
 * Hash válido que no corresponde a ninguna contraseña real. Se verifica cuando el usuario no
 * existe, para que la respuesta tarde lo mismo y no revele qué correos están registrados.
 */
export function getDummyHash(): Promise<string> {
  return (dummyHash ??= hashPassword(randomBytes(24).toString("hex")));
}
