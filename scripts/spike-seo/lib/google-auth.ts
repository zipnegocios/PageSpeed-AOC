// Reexportación: el código vive en src/server/seo/ y lo usan la plataforma y estos scripts.
import { readFileSync } from "node:fs";
import { parseServiceAccountKey, type ServiceAccountKey } from "../../../src/server/seo/google-auth";

export { clearTokenCache, getAccessToken, parseServiceAccountKey, type ServiceAccountKey } from "../../../src/server/seo/google-auth";

/** Lee la llave JSON de la cuenta de servicio desde un archivo. Nunca se imprime ni se guarda en la salida. */
export function readServiceAccountKey(path: string): ServiceAccountKey {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new Error(`No se pudo leer la llave de la cuenta de servicio en ${path}.`);
  }
  return parseServiceAccountKey(text);
}
