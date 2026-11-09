/**
 * Destino al que volver tras iniciar sesión. Solo rutas de esta misma aplicación: empieza por «/», no por «//» ni «/\»,
 * y no lleva saltos de línea. Cualquier otra cosa se descarta (nada de redirecciones abiertas).
 */
export function safeNext(value: string | null | undefined): string | null {
  if (!value || value.length > 2000) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  if (/[\r\n\0]/.test(value)) return null;
  return value;
}
