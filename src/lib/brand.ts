/**
 * Marca del producto: nombre, copyright y geometría del logo. Una sola fuente para pantallas, correos y PDF.
 * La geometría es la de `design/brand/logo-mark.svg` (lienzo de 256 unidades); si cambia allí, cambia aquí.
 */
export const BRAND_NAME = "PageSpeed";
export const BRAND_WORDMARK = "PAGESPEED";

export const COPYRIGHT_YEAR = 2026;
export const COPYRIGHT_OWNER = "zipnegocios";
export const COPYRIGHT_AUTHOR = "Gustavo Amarista";
/** «© 2026 zipnegocios · Gustavo Amarista» (zipnegocios siempre en minúsculas). */
export const COPYRIGHT = `© ${COPYRIGHT_YEAR} ${COPYRIGHT_OWNER} · ${COPYRIGHT_AUTHOR}`;
export const COPYRIGHT_LONG = `${COPYRIGHT}. Todos los derechos reservados.`;

/** Título de pestaña: «Sección · PageSpeed». */
export function pageTitle(section: string): string {
  return `${section} · ${BRAND_NAME}`;
}

/** El rayo y el chevron (dos subtrazados separados por una ranura diagonal). */
export const LOGO_BOLT_PATH = "M184 12 56 140h48l-11 54zM160 80l38 38L76 250 147 108z";
/** Caja del glifo solo (sin marco): `viewBox="40 0 176 256"`. */
export const LOGO_GLYPH_VIEWBOX = "40 0 176 256";
/** Marco cuadrado, cortado por la ranura. */
export const LOGO_FRAME_PATH = "M167 28H28V228H68L78 208H48V48H157ZM195 28H228V228H96L106 208H208V48H185Z";
/** Las cuatro marcas de esquina (trazo de 8 unidades). */
export const LOGO_CORNERS_PATH = "M10 46V10H46M210 10H246V46M246 210V246H210M46 246H10V210";
