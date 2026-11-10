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

/**
 * Lo que el cliente necesita entender de cada hallazgo, sin jerga: qué es, por qué importa y qué hacemos. Se enseña al abrir el hallazgo en
 * Tráfico → Salud SEO. Va junto a `SEO_CLIENT_TITLE` y cubre todos los códigos (los de «información» no se muestran al cliente, pero el tipo
 * obliga a explicarlos por si cambia su gravedad).
 */
export type SeoClientExplain = { what: string; why: string; fix: string };

export const SEO_CLIENT_EXPLAIN: Record<IssueCode, SeoClientExplain> = {
  status_error: {
    what: "Estas direcciones no se abren: el servidor responde con un error o no responde.",
    why: "Quien llega desde Google o desde un enlace se encuentra una página rota y se va; además, Google acaba retirándolas de sus resultados.",
    fix: "Restauramos la página, la redirigimos a otra equivalente o la quitamos de los enlaces del sitio.",
  },
  redirect_loop: {
    what: "Al abrir estas direcciones el sitio te manda de una a otra una y otra vez, sin llegar nunca a una página.",
    why: "Nadie puede verlas, ni las personas ni Google, así que es como si no existieran.",
    fix: "Hacemos que la dirección lleve directamente a su destino final.",
  },
  redirect_chain: {
    what: "Para llegar a estas páginas hay que pasar por dos o más redirecciones seguidas.",
    why: "Cada salto retrasa la carga y hace que Google dé menos valor a la dirección final.",
    fix: "Enlazamos directamente al destino final, sin pasos intermedios.",
  },
  http_not_redirected: {
    what: "Si alguien escribe tu dirección sin «https», el sitio se abre en su versión no segura en lugar de llevar a la segura.",
    why: "El navegador puede mostrar «No seguro» y Google trata como dos sitios distintos lo que es uno solo.",
    fix: "Configuramos el sitio para que toda visita acabe en la versión segura (https).",
  },
  broken_link: {
    what: "Hay páginas de tu sitio que enlazan a otra dirección que no existe o da error.",
    why: "Los visitantes se topan con un callejón sin salida y Google lo interpreta como un sitio descuidado.",
    fix: "Corregimos el enlace o restauramos la página a la que apuntaba.",
  },
  orphan_page: {
    what: "Son páginas que existen, pero ninguna otra página del sitio lleva a ellas.",
    why: "Quien navega no llega a ellas y a Google le cuesta entender que son importantes.",
    fix: "Las enlazamos desde el menú o desde páginas relacionadas, o las retiramos si ya no sirven.",
  },
  sitemap_url_noindex: {
    what: "Tu mapa del sitio ofrece a Google estas páginas, pero ellas mismas piden que no se muestren en los resultados.",
    why: "Se envían señales contradictorias y esas páginas no aparecerán en Google aunque quieras que lo hagan.",
    fix: "Quitamos la marca que las oculta si deben aparecer, o las sacamos del mapa del sitio si no.",
  },
  sitemap_url_blocked: {
    what: "Tu mapa del sitio ofrece a Google estas páginas, pero el archivo robots.txt le prohíbe revisarlas.",
    why: "Google no puede leerlas ni mostrarlas bien en sus resultados.",
    fix: "Permitimos su revisión en robots.txt o las sacamos del mapa del sitio.",
  },
  sitemap_url_redirected: {
    what: "El mapa del sitio lista direcciones que en realidad llevan a otra dirección distinta.",
    why: "Google pierde tiempo siguiendo saltos y puede quedarse con la dirección equivocada.",
    fix: "Sustituimos cada dirección del mapa por la de su destino final.",
  },
  robots_missing: {
    what: "Tu sitio no tiene el archivo robots.txt, la nota que le dice a los buscadores por dónde pueden pasar.",
    why: "No es grave, pero sin él no puedes guiar a Google ni indicarle dónde está tu mapa del sitio.",
    fix: "Creamos un robots.txt sencillo que indica el mapa del sitio.",
  },
  robots_unreadable: {
    what: "El archivo robots.txt existe, pero el servidor no lo entregó bien cuando lo revisamos.",
    why: "Ante la duda, algunos buscadores tratan el sitio como si estuviera bloqueado y dejan de revisarlo.",
    fix: "Revisamos por qué falla el servidor y dejamos el archivo accesible.",
  },
  site_blocked: {
    what: "Tu sitio le pide a todos los buscadores que no lo revisen.",
    why: "Si no es lo que buscas, ninguna página aparecerá en Google. Es habitual mientras se construye un sitio, pero hay que quitarlo al publicar.",
    fix: "Si el sitio ya debe estar visible, quitamos el bloqueo. Si es a propósito, no hay que hacer nada.",
  },
  sitemap_missing: {
    what: "No encontramos un mapa del sitio, la lista de páginas que se ofrece a Google.",
    why: "Sin él, Google tarda más en descubrir páginas nuevas y puede olvidar algunas.",
    fix: "Generamos el mapa del sitio y lo indicamos a Google.",
  },
  sitemap_unreadable: {
    what: "Hay un mapa del sitio, pero no se puede leer o no tiene el formato esperado.",
    why: "Google no puede aprovecharlo, así que es como no tenerlo.",
    fix: "Corregimos su formato para que Google lo lea sin problema.",
  },
  sitemap_not_in_robots: {
    what: "El archivo robots.txt no indica dónde está el mapa del sitio.",
    why: "Los buscadores pueden tardar más en encontrarlo.",
    fix: "Añadimos la dirección del mapa del sitio en robots.txt.",
  },
  canonical_missing: {
    what: "Estas páginas no declaran cuál es su dirección principal, la que Google debe guardar como oficial.",
    why: "Si la misma página se alcanza por varias direcciones, Google puede repartir su valor entre ellas o elegir la que no quieres.",
    fix: "Declaramos en cada página su dirección principal.",
  },
  canonical_target_bad: {
    what: "La dirección que estas páginas declaran como principal da error o redirige a otra.",
    why: "Google se queda sin una dirección fiable y puede dejar de mostrar la página.",
    fix: "Apuntamos la dirección principal a una página que funciona.",
  },
  canonical_other_language: {
    what: "Estas páginas dicen que su versión oficial es la de otro idioma.",
    why: "Google puede ocultar la página y mostrar solo la del otro idioma, así que dejas de aparecer para parte de tu público.",
    fix: "Hacemos que cada página declare como principal su propia versión de idioma.",
  },
  title_missing: {
    what: "Estas páginas no tienen título: el texto que aparece en la pestaña del navegador y como encabezado azul en Google.",
    why: "Google inventa uno o muestra algo poco claro, y se hacen menos clics.",
    fix: "Escribimos un título claro y único para cada página.",
  },
  title_length: {
    what: "El título de estas páginas es demasiado corto (desaprovecha espacio) o demasiado largo (Google lo corta).",
    why: "Un título cortado o pobre explica peor de qué trata la página y atrae menos visitas.",
    fix: "Ajustamos cada título a una longitud que se vea completa en Google.",
  },
  title_duplicate: {
    what: "Varias páginas tienen exactamente el mismo título.",
    why: "Google no sabe cuál mostrar para cada búsqueda y las personas no distinguen un resultado de otro.",
    fix: "Damos a cada página un título propio.",
  },
  description_missing: {
    what: "Estas páginas no tienen descripción: el texto breve que aparece bajo el título en los resultados de Google.",
    why: "Google escoge un fragmento al azar, que suele ser poco atractivo, y se hacen menos clics.",
    fix: "Escribimos una descripción breve y atractiva para cada página.",
  },
  description_long: {
    what: "La descripción de estas páginas es tan larga que Google la corta a mitad de frase.",
    why: "El mensaje queda incompleto justo donde querías convencer.",
    fix: "La resumimos para que se lea entera.",
  },
  description_duplicate: {
    what: "Varias páginas tienen exactamente la misma descripción.",
    why: "Los resultados se ven repetidos y no ayudan a elegir.",
    fix: "Escribimos una descripción distinta para cada página.",
  },
  h1_missing: {
    what: "Estas páginas no tienen un encabezado principal: el título grande que dice de qué trata la página.",
    why: "A las personas y a Google les cuesta entender el tema de la página de un vistazo.",
    fix: "Añadimos un encabezado principal claro a cada página.",
  },
  h1_multiple: {
    what: "Estas páginas tienen más de un encabezado principal compitiendo entre sí.",
    why: "La página no deja claro cuál es su tema principal.",
    fix: "Dejamos un único encabezado principal y convertimos el resto en subtítulos.",
  },
  client_rendered: {
    what: "El contenido de estas páginas solo aparece cuando el navegador ejecuta programas del sitio; sin ellos la página llega casi vacía.",
    why: "Google y otras herramientas pueden leer menos de lo que ves tú, y nosotros no podemos revisar bien su contenido.",
    fix: "Valoramos que el servidor entregue la página completa desde el principio.",
  },
  lang_missing: {
    what: "Estas páginas no declaran en qué idioma están escritas.",
    why: "Los buscadores y los lectores de pantalla pueden equivocarse al interpretarlas o al leerlas en voz alta.",
    fix: "Declaramos el idioma de cada página.",
  },
  lang_mismatch: {
    what: "El idioma que declara cada una de estas páginas no coincide con el de su dirección (por ejemplo, una dirección en inglés que se declara en español).",
    why: "Google puede mostrarla a un público que no corresponde.",
    fix: "Corregimos el idioma declarado para que coincida con el de la página.",
  },
  hreflang_invalid_code: {
    what: "Las páginas indican sus versiones en otros idiomas con un código que no existe o está mal escrito.",
    why: "Google ignora esa indicación y puede mostrar la versión equivocada a cada visitante.",
    fix: "Sustituimos esos códigos por los correctos.",
  },
  hreflang_no_self: {
    what: "Estas páginas enumeran sus versiones en otros idiomas, pero se olvidan de incluirse a sí mismas.",
    why: "Google puede descartar la lista entera por incompleta.",
    fix: "Añadimos cada página a su propia lista de idiomas.",
  },
  hreflang_not_reciprocal: {
    what: "Estas páginas apuntan a su versión en otro idioma, pero esa versión no apunta de vuelta.",
    why: "Google solo hace caso a las versiones por idioma cuando se enlazan entre sí en ambos sentidos.",
    fix: "Hacemos que cada par de versiones se enlace mutuamente.",
  },
  hreflang_target_bad: {
    what: "Estas páginas apuntan a una versión en otro idioma que da error, redirige o está oculta para Google.",
    why: "Google ignora esa versión y los visitantes de ese idioma no llegan a ella.",
    fix: "Apuntamos a la versión correcta o arreglamos la que falla.",
  },
  hreflang_wrong_language: {
    what: "El idioma que se anuncia para algunas versiones no coincide con el idioma real de la página a la que apuntan.",
    why: "Google puede enseñar a cada visitante la versión en un idioma que no es el suyo.",
    fix: "Corregimos el idioma anunciado de cada versión.",
  },
  hreflang_absent: {
    what: "Tu sitio tiene varios idiomas, pero ninguna página indica cuáles son sus versiones en los demás.",
    why: "Google no sabe qué versión mostrar a cada persona según su idioma.",
    fix: "Declaramos las versiones por idioma en todas las páginas.",
  },
  x_default_missing: {
    what: "No hay una versión por defecto para quienes hablan un idioma que tu sitio no ofrece.",
    why: "Google elige por su cuenta qué versión mostrarles.",
    fix: "Indicamos una versión por defecto si conviene.",
  },
  language_without_pages: {
    what: "Tu proyecto tiene configurados idiomas de los que no encontramos ninguna página.",
    why: "O falta contenido en ese idioma, o la configuración está desfasada.",
    fix: "Confirmamos contigo si hay que crear esas páginas o quitar el idioma.",
  },
  jsonld_invalid: {
    what: "La información adicional que tu sitio entrega a Google (horarios, organización, productos…) tiene un error de escritura y no se puede leer.",
    why: "Google la descarta y pierdes la oportunidad de mostrar resultados más completos.",
    fix: "Corregimos el error para que Google la entienda.",
  },
  jsonld_missing_props: {
    what: "La información adicional que tu sitio entrega a Google está incompleta: faltan datos importantes.",
    why: "Google puede no mostrar los resultados enriquecidos (valoraciones, precios, preguntas…).",
    fix: "Completamos los datos que faltan.",
  },
  jsonld_home_missing: {
    what: "La portada no cuenta a Google quién eres: el nombre de tu empresa o de tu sitio.",
    why: "Google entiende peor de quién es la web y puede mostrar menos datos tuyos.",
    fix: "Añadimos los datos de tu organización en la portada.",
  },
};
