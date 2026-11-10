/**
 * Datos de la bienvenida al cliente: tecnologías que se ofrecen, nota de fin de soporte según la tecnología y lectura
 * de las personas en copia. Lógica pura.
 */

// ----------------------------------------------------------------- productos

/** Normaliza para comparar: sin acentos, en minúsculas y sin espacios sobrantes. */
const key = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/**
 * Qué es cada producto del cliente. Es texto libre (un cliente puede tener un marketplace, una app móvil, un chatbot…);
 * estas sugerencias solo ayudan a escribirlo, agrupadas para mostrarlas por familias.
 */
export const SOLUTION_SUGGESTIONS: ReadonlyArray<{ group: string; items: string[] }> = [
  { group: "Web", items: ["sitio web corporativo", "landing page", "blog o sitio de contenidos", "portafolio", "directorio o clasificados", "comunidad o red social"] },
  { group: "Comercio", items: ["tienda online (e-commerce)", "marketplace", "plataforma de pedidos o delivery", "pasarela de pagos o checkout", "facturación electrónica"] },
  { group: "Educación y servicios", items: ["plataforma de e-learning", "plataforma de reservas o citas", "plataforma de eventos o ticketing", "portal de clientes o intranet"] },
  { group: "Aplicaciones", items: ["aplicación web (SaaS)", "aplicación móvil iOS", "aplicación móvil Android", "aplicación móvil multiplataforma", "PWA (app instalable)", "software a medida"] },
  { group: "Gestión y datos", items: ["CRM", "ERP", "dashboard o reportes (BI)", "API o integración"] },
  { group: "IA y automatización", items: ["chatbot", "asistente de IA", "automatización de procesos"] },
];

/** Tecnologías sugeridas, por familia. El campo es libre: lo que no esté aquí se acepta igual. */
export const TECH_SUGGESTIONS: ReadonlyArray<{ group: string; items: string[] }> = [
  { group: "CMS y comercio", items: ["WordPress", "WooCommerce", "Shopify", "PrestaShop", "Joomla", "Drupal", "Magento", "Wix", "Squarespace", "Webflow", "Odoo", "Strapi", "Ghost"] },
  { group: "Front-end", items: ["HTML y CSS", "JavaScript", "TypeScript", "React", "Next.js", "Vue", "Nuxt", "Angular", "Svelte", "Astro", "Tailwind CSS"] },
  { group: "Back-end", items: ["Node.js", "Express", "NestJS", "PHP", "Laravel", "Symfony", "Python", "Django", "FastAPI", "Flask", "Ruby on Rails", "Java", "Spring Boot", ".NET", "Go", "Rust"] },
  { group: "Móvil", items: ["Swift (iOS)", "Kotlin (Android)", "Flutter", "React Native", "Expo", "Ionic", "Capacitor"] },
  { group: "Datos", items: ["PostgreSQL", "MySQL", "MariaDB", "MongoDB", "Redis", "SQLite", "Firebase", "Supabase", "Elasticsearch"] },
  { group: "Nube e infraestructura", items: ["AWS", "Google Cloud", "Azure", "Cloudflare", "Vercel", "Netlify", "Docker", "Kubernetes", "VPS", "Nginx", "EasyPanel"] },
  { group: "IA y automatización", items: ["OpenAI", "Claude", "LangChain", "Dialogflow", "n8n", "Make", "Zapier", "WhatsApp Business API", "Twilio"] },
  { group: "Aprendizaje, CRM y pagos", items: ["Moodle", "LearnDash", "HubSpot", "Salesforce", "Zoho", "Stripe", "PayPal", "Mercado Pago", "Wompi", "PayU"] },
];

export const MAX_PRODUCT_TAGS = 12;
export const MAX_TAG_LENGTH = 60;

/**
 * Limpia una lista de etiquetas escrita a mano: recorta, quita vacías y repetidas (sin distinguir mayúsculas), y valida el
 * tope. Devuelve la lista y, si algo no cuadra, el mensaje.
 */
export function cleanTags(raw: unknown, label: string): { tags: string[]; error?: string } {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  const tags: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const t = item.replace(/\s+/g, " ").trim();
    if (!t) continue;
    if (t.length > MAX_TAG_LENGTH) return { tags: [], error: `${label}: cada elemento admite hasta ${MAX_TAG_LENGTH} caracteres.` };
    if (/[<>]/.test(t)) return { tags: [], error: `${label}: no uses los signos < ni >.` };
    if (!tags.some((x) => key(x) === key(t))) tags.push(t);
  }
  if (tags.length > MAX_PRODUCT_TAGS) return { tags: [], error: `${label}: máximo ${MAX_PRODUCT_TAGS} elementos.` };
  return { tags };
}

// ------------------------------------------------------------------ servicios

/** Qué incluye el acompañamiento en cada producto. El correo solo promete lo que está marcado. */
export const SERVICE_KEYS = ["web", "seo", "server", "deps", "domain", "security"] as const;
export type ServiceKey = (typeof SERVICE_KEYS)[number];

export const SERVICE_LABEL: Record<ServiceKey, string> = {
  web: "Rendimiento web",
  seo: "Visitas y visibilidad",
  server: "Servidor, servicios y APIs",
  deps: "Dependencias e integraciones",
  domain: "Dominio, DNS y certificados",
  security: "Seguridad y actualizaciones",
};

/** Lo que se marca por defecto en un producto nuevo (lo que la plataforma mide hoy, más la seguridad que tú supervisas). */
export const DEFAULT_SERVICES: ServiceKey[] = ["web", "seo", "security"];

export function isServiceKey(value: unknown): value is ServiceKey {
  return typeof value === "string" && (SERVICE_KEYS as readonly string[]).includes(value);
}

/** Deja solo servicios conocidos, sin repetir y en el orden de siempre. */
export function cleanServices(raw: unknown): ServiceKey[] {
  const set = new Set(Array.isArray(raw) ? raw.filter(isServiceKey) : []);
  return SERVICE_KEYS.filter((k) => set.has(k));
}

/** Los servicios que cubre al menos uno de los productos. */
export function unionServices(products: Array<{ services: readonly string[] }>): Set<ServiceKey> {
  const out = new Set<ServiceKey>();
  for (const p of products) for (const k of p.services) if (isServiceKey(k)) out.add(k);
  return out;
}

// ------------------------------------------------------------ fin de soporte

type Runtime = "php" | "node";

/** Tecnologías cuyo fin de soporte se cita en la bienvenida. Las demás se aceptan y simplemente no llevan esa nota. */
const RUNTIME_OF: Record<string, Runtime> = {
  wordpress: "php",
  woocommerce: "php",
  prestashop: "php",
  joomla: "php",
  drupal: "php",
  magento: "php",
  laravel: "php",
  symfony: "php",
  php: "php",
  "next.js": "node",
  express: "node",
  nestjs: "node",
  nuxt: "node",
  "node.js": "node",
};

/**
 * Datos de fin de soporte que se citan en la bienvenida. Cada uno caduca: pasada su fecha `until` se omite, para no
 * mandar un dato viejo. Fuentes: endoflife.date/php y endoflife.date/nodejs. REVISAR CADA TRIMESTRE.
 */
const END_OF_SUPPORT: Record<Runtime, { note: string; until: string }> = {
  php: { note: "PHP 8.2 deja de recibir parches de seguridad el 31 de diciembre de 2026.", until: "2026-12-31" },
  node: { note: "Node.js 20 dejó de recibir parches de seguridad el 30 de abril de 2026.", until: "2027-04-30" },
};

/** La nota de fin de soporte que corresponde a las tecnologías del producto, o null si no aplica o ya caducó. */
export function endOfSupportNote(techs: string[] | string, now: Date): string | null {
  const list = Array.isArray(techs) ? techs : [techs];
  const today = now.toISOString().slice(0, 10);
  for (const t of list) {
    const runtime = RUNTIME_OF[key(t)];
    if (!runtime) continue;
    const entry = END_OF_SUPPORT[runtime];
    if (today <= entry.until) return entry.note;
  }
  return null;
}

// ------------------------------------------------------------ personas en copia

export type CcContact = { name: string; email: string };
export const MAX_CC_CONTACTS = 10;

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]{2,}$/;

export class CcParseError extends Error {}

/**
 * Lee la lista de personas en copia, una por línea. Acepta «Nombre <correo>», «Nombre, correo» y solo «correo».
 * Lanza `CcParseError` con la línea que falla.
 *
 * Dos personas pueden compartir una misma dirección (incluida la del contacto principal): cada una va en su línea y se
 * nombran las dos en el saludo, pero el correo llega una sola vez a esa dirección. Una línea que repite una dirección ya
 * usada y no trae nombre no aporta nada y se descarta, igual que una línea idéntica repetida.
 */
export function parseCcContacts(text: string, exclude: string[] = []): CcContact[] {
  const taken = new Set(exclude.map((e) => e.trim().toLowerCase()).filter(Boolean));
  const seen = new Set<string>();
  const out: CcContact[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let name = "";
    let email = "";
    const angle = /^(.*?)<\s*([^<>]+?)\s*>$/.exec(line);
    if (angle) {
      name = angle[1]!.trim().replace(/^["']|["']$/g, "").replace(/,$/, "").trim();
      email = angle[2]!;
    } else if (line.includes(",") || line.includes(";")) {
      const parts = line.split(/[,;]/).map((p) => p.trim());
      const at = parts.findIndex((p) => EMAIL_RE.test(p));
      if (at === -1) throw new CcParseError(`No encuentro un correo válido en «${line}».`);
      email = parts[at]!;
      name = parts.filter((_, i) => i !== at).join(" ").trim();
    } else {
      email = line;
    }
    email = email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new CcParseError(`El correo «${email || line}» no es válido.`);
    name = name.slice(0, 80);
    if (!name && (taken.has(email) || out.some((c) => c.email === email))) continue; // sin nombre, no aporta nada
    const id = `${email}|${key(name)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ name, email });
  }
  if (out.length > MAX_CC_CONTACTS) throw new CcParseError(`Máximo ${MAX_CC_CONTACTS} personas en copia.`);
  return out;
}

/** El texto del formulario a partir de lo guardado: una persona por línea. */
export function formatCcContacts(contacts: CcContact[]): string {
  return contacts.map((c) => (c.name ? `${c.name} <${c.email}>` : c.email)).join("\n");
}

/**
 * Las direcciones a las que va el correo en copia: una vez cada una, sin la del contacto principal (ya va en «Para»).
 * Dos personas con la misma dirección no la repiten.
 */
export function ccAddresses(contacts: CcContact[], primaryEmail: string | null | undefined): string[] {
  const primary = (primaryEmail ?? "").trim().toLowerCase();
  const out: string[] = [];
  for (const c of contacts) {
    const e = c.email.trim().toLowerCase();
    if (e && e !== primary && !out.includes(e)) out.push(e);
  }
  return out;
}

/** Segundos nombres frecuentes: «Ana María Osorio» se saluda «Ana María», no «Ana». */
const SECOND_GIVEN = new Set(
  ["maria", "jose", "luis", "carlos", "juan", "pablo", "antonio", "fernando", "isabel", "luisa", "paula", "fernanda", "alejandra", "eugenia", "teresa", "elena", "victoria", "cristina", "andrea", "camila", "valentina", "sofia", "lucia", "patricia", "gabriela", "daniela", "carolina", "alberto", "eduardo", "miguel", "angel", "manuel", "rafael", "ricardo", "andres", "felipe", "esteban", "javier", "alejandro", "david", "daniel", "emilio", "enrique", "francisco", "jorge", "ignacio", "nicolas", "sebastian"],
);
/** Con solo dos palabras («Ana María») solo se junta si la primera también es de las que suelen ir compuestas. */
const FIRST_COMPOUND = new Set(["ana", "maria", "jose", "juan", "luis", "carlos", "rosa", "luz", "miguel", "pedro", "marta"]);

/**
 * El nombre de pila para el saludo. Un nombre compuesto frecuente se respeta: «Ana María Osorio» → «Ana María»;
 * «Daniel Osorio» → «Daniel». Lo que va entre paréntesis se ignora. Se ve en vivo en el formulario por si hay que ajustarlo.
 */
export function givenName(full: string): string {
  const words = full.replace(/\([^)]*\)/g, " ").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const second = words[1] ? key(words[1]) : "";
  if (words.length >= 3 && SECOND_GIVEN.has(second)) return `${words[0]} ${words[1]}`;
  if (words.length === 2 && SECOND_GIVEN.has(second) && FIRST_COMPOUND.has(key(words[0]!))) return `${words[0]} ${words[1]}`;
  return words[0]!;
}

/** Nombres para el saludo: el contacto principal primero y luego las personas en copia con nombre, sin repetir. */
export function greetingNames(primaryName: string | null | undefined, cc: CcContact[]): string[] {
  const names = [primaryName ?? "", ...cc.map((c) => c.name)].map(givenName).filter(Boolean);
  return names.filter((n, i) => names.findIndex((m) => key(m) === key(n)) === i);
}

/** El sitio como se muestra en el correo: el host sin «www.». */
export function siteLabel(baseUrl: string): string {
  try {
    return new URL(baseUrl).host.replace(/^www\./, "");
  } catch {
    return baseUrl;
  }
}
