/** Lado máximo del isotipo (se entrega cuadrado) y caja máxima del logotipo completo, en píxeles. */
export const ICON_SIDE = 512;
export const FULL_MAX = { width: 1024, height: 384 } as const;
/** Peso máximo que se intenta lograr antes de subir (el servidor acepta hasta 512 000 bytes). */
const TARGET_BYTES = 450_000;

/** ¿Es un tipo de imagen que se admite como logotipo? (todo se convierte a PNG en el navegador). */
export const isLogoType = (type: string) => /^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(type);

function load(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("imagen"));
    };
    img.src = url;
  });
}

const toPng = (canvas: HTMLCanvasElement) => new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));

/**
 * Convierte la imagen elegida en un PNG con transparencia: SVG, JPEG, WebP o GIF pasan a PNG aquí, así el servidor solo
 * recibe PNG (sin SVG, que podría llevar scripts) y el PDF y los iconos de la app lo leen sin más. El isotipo se entrega
 * cuadrado (centrado, con margen transparente); el logotipo completo conserva su proporción, sin recortes.
 */
export async function logoBlob(file: File, kind: "icon" | "full"): Promise<Blob> {
  const img = await load(file);
  // Un SVG sin tamaño propio no trae medidas: se le da una caja razonable.
  const sw = img.naturalWidth || 512;
  const sh = img.naturalHeight || 512;
  const isSvg = file.type === "image/svg+xml";
  const box = kind === "icon" ? { width: ICON_SIDE, height: ICON_SIDE } : FULL_MAX;
  // Las imágenes de trama no se agrandan (se verían borrosas); el SVG sí, porque es vectorial.
  let scale = Math.min(box.width / sw, box.height / sh);
  if (!isSvg) scale = Math.min(scale, 1);
  for (let attempt = 0; attempt < 5; attempt++) {
    const w = Math.max(1, Math.round(sw * scale));
    const h = Math.max(1, Math.round(sh * scale));
    const canvas = document.createElement("canvas");
    canvas.width = kind === "icon" ? Math.max(w, h) : w;
    canvas.height = kind === "icon" ? Math.max(w, h) : h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    const blob = await toPng(canvas);
    if (!blob) throw new Error("blob");
    if (blob.size <= TARGET_BYTES) return blob;
    scale *= 0.75;
  }
  throw new Error("peso");
}
