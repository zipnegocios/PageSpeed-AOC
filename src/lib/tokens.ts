import tokens from "../../design/tokens.json";

/** Color de un token en el tema claro, para lugares que no pueden leer variables CSS (PDF, manifiesto). */
export function lightToken(name: string): string {
  const t = tokens.color.tokens.find((x) => x.name === name);
  const v = t?.value as { light?: string } | string | undefined;
  return (typeof v === "string" ? v : v?.light) ?? "#000000";
}
