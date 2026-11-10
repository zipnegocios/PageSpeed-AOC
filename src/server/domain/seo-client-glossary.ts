import type { IssueCode, IssueGroup } from "./seo-crawl-rules";

/**
 * Los hallazgos del rastreo técnico dichos para el cliente: qué le pasa al sitio, sin jerga (canónica, hreflang, JSON-LD…).
 * Cada texto se lee solo y en plural («Páginas sin título»), porque lo acompaña el número de páginas afectadas. El catálogo
 * técnico (`ISSUE_CATALOG`) sigue siendo el del administrador.
 */
export const SEO_CLIENT_TITLE: Record<IssueCode, string> = {
  status_error: "Páginas que dan error al abrirse",
  redirect_loop: "Páginas que redirigen en círculo y nunca cargan",
  redirect_chain: "Páginas que pasan por varias redirecciones antes de cargar",
  http_not_redirected: "La versión sin https no lleva a la versión segura",
  broken_link: "Enlaces del sitio que llevan a páginas rotas",
  orphan_page: "Páginas a las que ningún enlace del sitio lleva",
  sitemap_url_noindex: "Páginas ofrecidas a Google pero marcadas para que no las muestre",
  sitemap_url_blocked: "Páginas ofrecidas a Google pero bloqueadas para su revisión",
  sitemap_url_redirected: "El mapa del sitio lista direcciones que redirigen a otras",
  robots_missing: "El sitio no tiene archivo robots.txt",
  robots_unreadable: "No se pudo leer el archivo robots.txt",
  site_blocked: "El sitio pide a los buscadores que no lo revisen",
  sitemap_missing: "El sitio no tiene mapa del sitio (sitemap)",
  sitemap_unreadable: "El mapa del sitio no se puede leer",
  sitemap_not_in_robots: "El mapa del sitio no está indicado en robots.txt",
  canonical_missing: "Páginas sin dirección principal declarada (canónica)",
  canonical_target_bad: "Páginas cuya dirección principal apunta a una página con problemas",
  canonical_other_language: "Páginas cuya dirección principal apunta a la versión de otro idioma",
  title_missing: "Páginas sin título",
  title_length: "Páginas con un título demasiado corto o demasiado largo",
  title_duplicate: "Páginas con el mismo título",
  description_missing: "Páginas sin descripción para los buscadores",
  description_long: "Páginas con una descripción demasiado larga (se corta en los resultados)",
  description_duplicate: "Páginas con la misma descripción",
  h1_missing: "Páginas sin encabezado principal",
  h1_multiple: "Páginas con más de un encabezado principal",
  client_rendered: "Páginas cuyo contenido solo aparece al ejecutar JavaScript",
  lang_missing: "Páginas que no declaran su idioma",
  lang_mismatch: "Páginas cuyo idioma declarado no coincide con el de su dirección",
  hreflang_invalid_code: "Versiones por idioma con un código no válido",
  hreflang_no_self: "Versiones por idioma que no se incluyen a sí mismas",
  hreflang_not_reciprocal: "Versiones por idioma que no se enlazan entre sí",
  hreflang_target_bad: "Versiones por idioma que apuntan a páginas con problemas",
  hreflang_wrong_language: "Versiones por idioma que declaran el idioma equivocado",
  hreflang_absent: "Las versiones por idioma no están declaradas",
  x_default_missing: "Falta indicar la versión por defecto entre idiomas",
  language_without_pages: "Idiomas declarados sin ninguna página",
  jsonld_invalid: "Datos estructurados con errores",
  jsonld_missing_props: "Datos estructurados a los que les falta información",
  jsonld_home_missing: "La portada no declara la organización o el sitio",
};

/** Los seis grupos del catálogo con el nombre que ve el cliente, en el orden en que se muestran. */
export const SEO_CLIENT_GROUPS: ReadonlyArray<{ group: IssueGroup; label: string; hint: string }> = [
  { group: "acceso", label: "Acceso y enlaces", hint: "Que cada página se abra y se pueda llegar a ella." },
  { group: "indexacion", label: "Indexación", hint: "Que Google pueda encontrar y mostrar tus páginas." },
  { group: "canonica", label: "Direcciones principales", hint: "Que cada contenido tenga una sola dirección de referencia." },
  { group: "contenido", label: "Contenido", hint: "Títulos, descripciones y encabezados de cada página." },
  { group: "idiomas", label: "Idiomas", hint: "Que cada versión del sitio se asocie bien a su idioma." },
  { group: "datos", label: "Datos estructurados", hint: "La información que ayuda a Google a entender tu sitio." },
];
