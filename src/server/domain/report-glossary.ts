/** Glosario del informe de ingeniería: cada siglas o medida, dicha sin jerga. */
export type GlossaryEntry = { term: string; meaning: string };

export const REPORT_GLOSSARY: readonly GlossaryEntry[] = [
  { term: "Lighthouse", meaning: "La herramienta de Google que abre cada página en un navegador real y la mide. Todas las notas de este informe salen de sus mediciones." },
  { term: "Nota de 0 a 100", meaning: "Cada rubro se puntúa de 0 a 100: 90 o más es bueno, de 50 a 89 es mejorable y menos de 50 es deficiente." },
  { term: "Meta", meaning: "La nota mínima acordada para el sitio. Si un rubro baja de ella, aparece como punto por mejorar." },
  { term: "Móvil y escritorio", meaning: "Cada página se mide dos veces: simulando un teléfono con conexión móvil y un ordenador. Suelen dar notas distintas." },
  { term: "LCP", meaning: "Tiempo hasta que aparece el contenido principal de la página (la imagen o el título grande). Bueno: hasta 2,5 segundos." },
  { term: "CLS", meaning: "Cuánto se mueven los elementos mientras la página carga. Un número bajo evita toques equivocados. Bueno: hasta 0,1." },
  { term: "TBT", meaning: "Tiempo en que la página no responde a los toques mientras carga. Bueno: hasta 200 milisegundos." },
  { term: "Navegación agéntica", meaning: "Comprobaciones de que asistentes de inteligencia artificial pueden entender y usar la página. Es una medida nueva: se muestra como «superadas / totales» y no genera alertas." },
  { term: "Sitemap", meaning: "El mapa del sitio: la lista de páginas que se ofrece a Google para que las encuentre." },
  { term: "robots.txt", meaning: "El archivo que le dice a los buscadores qué partes del sitio pueden revisar." },
  { term: "Canónica", meaning: "La dirección principal de un contenido, para que Google no lo confunda con copias." },
  { term: "Versiones por idioma (hreflang)", meaning: "La señal que enlaza cada página con su versión en otro idioma." },
  { term: "Datos estructurados", meaning: "Información en un formato que ayuda a Google a entender de qué trata cada página." },
  { term: "INP", meaning: "Cuánto tarda la página en responder cuando alguien toca o hace clic, medido con visitantes reales. Bueno: hasta 200 milisegundos." },
  { term: "FCP y TTFB", meaning: "FCP: cuándo aparece el primer contenido. TTFB: cuánto tarda el servidor en empezar a responder. Se miden con visitantes reales." },
  { term: "Percentil 75 (p75)", meaning: "El valor que tres de cada cuatro visitas igualan o mejoran. Es la cifra que usa Google para evaluar la experiencia real." },
  { term: "Core Web Vitals", meaning: "Las tres medidas de Google sobre la experiencia de carga: LCP, INP y CLS. La evaluación se aprueba si las tres están en «bueno»." },
  { term: "Fuente de visitas", meaning: "De dónde llegó cada visita: un buscador, una red social, otro sitio web, un correo, un anuncio o directamente." },
  { term: "Directo o sin identificar", meaning: "Visitas que llegan sin informar su origen: quien escribe tu dirección, un marcador o una aplicación (por ejemplo, un mensaje privado). Con enlaces con UTM se puede saber más." },
  { term: "UTM", meaning: "Etiquetas que se agregan a un enlace (por ejemplo, ?utm_source=instagram) para que Google Analytics sepa de dónde viene cada visita." },
  { term: "Consulta", meaning: "Las palabras que escribe una persona en Google antes de llegar a tu sitio." },
  { term: "Sesión", meaning: "Una visita al sitio: desde que alguien llega hasta que se va." },
  { term: "CTR", meaning: "De cada cien veces que tu sitio aparece en Google, cuántas veces alguien hace clic." },
  { term: "Posición media", meaning: "El lugar que ocupa tu sitio en los resultados de Google. Más cerca de 1 es mejor." },
];
