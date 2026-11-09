/** Lado de las fotos de perfil, en píxeles. */
export const AVATAR_SIDE = 256;

/**
 * Recorta al centro un cuadrado y lo reduce a 256×256 (WebP, con JPEG de respaldo). Solo para el navegador: la foto sube
 * ligera y el servidor no necesita librerías de imagen; igualmente la vuelve a validar por firma y tamaño.
 */
export async function squareBlob(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIDE;
  canvas.height = AVATAR_SIDE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_SIDE, AVATAR_SIDE);
  bitmap.close();
  const toBlob = (type: string, q: number) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, q));
  return (await toBlob("image/webp", 0.9)) ?? (await toBlob("image/jpeg", 0.9)) ?? Promise.reject(new Error("blob"));
}

/** ¿Es un tipo de imagen que se admite como foto? */
export const isAvatarType = (type: string) => /^image\/(png|jpeg|webp)$/.test(type);
