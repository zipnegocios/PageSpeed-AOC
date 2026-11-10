/**
 * Datos de la bienvenida al cliente: tecnologías que se ofrecen, nota de fin de soporte según la tecnología y lectura
 * de las personas en copia. Lógica pura.
 */

export type ProjectKindValue = "site" | "shop" | "app";
export const PROJECT_KINDS: ProjectKindValue[] = ["site", "shop", "app"];

/** Cómo lo llama el correo: «tu sitio», «tu tienda», «tu aplicación». */
export const PROJECT_KIND_LABEL: Record<ProjectKindValue, "sitio" | "tienda" | "aplicación"> = {
  site: "sitio",
  shop: "tienda",
  app: "aplicación",
};

export function isProjectKind(value: unknown): value is ProjectKindValue {
  return typeof value === "string" && (PROJECT_KINDS as string[]).includes(value);
}

type Runtime = "php" | "node" | "none";

/** Sugerencias del formulario. El campo es libre: lo que no esté aquí se acepta y simplemente no lleva nota de versiones. */
export const TECH_SUGGESTIONS: Array<{ label: string; runtime: Runtime }> = [
  { label: "WordPress", runtime: "php" },
  { label: "PrestaShop", runtime: "php" },
  { label: "Joomla", runtime: "php" },
  { label: "Laravel", runtime: "php" },
  { label: "Shopify", runtime: "none" },
  { label: "Next.js", runtime: "node" },
  { label: "Express", runtime: "node" },
  { label: "Angular", runtime: "none" },
  { label: "HTML y CSS", runtime: "none" },
];

/** Normaliza para comparar: sin acentos, en minúsculas y sin espacios sobrantes. */
const key = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

function runtimeOf(techLabel: string): Runtime {
  const k = key(techLabel);
  return TECH_SUGGESTIONS.find((t) => key(t.label) === k)?.runtime ?? "none";
}

/**
 * Datos de fin de soporte que se citan en la bienvenida. Cada uno caduca: pasada su fecha `until` se omite, para no
 * mandar un dato viejo. Fuentes: endoflife.date/php y endoflife.date/nodejs. REVISAR CADA TRIMESTRE.
 */
const END_OF_SUPPORT: Record<Exclude<Runtime, "none">, { note: string; until: string }> = {
  php: { note: "PHP 8.2 deja de recibir parches de seguridad el 31 de diciembre de 2026.", until: "2026-12-31" },
  node: { note: "Node.js 20 dejó de recibir parches de seguridad el 30 de abril de 2026.", until: "2027-04-30" },
};

/** La nota de fin de soporte que corresponde a la tecnología, o null si no aplica o ya caducó. */
export function endOfSupportNote(techLabel: string, now: Date): string | null {
  const runtime = runtimeOf(techLabel);
  if (runtime === "none") return null;
  const entry = END_OF_SUPPORT[runtime];
  return now.toISOString().slice(0, 10) <= entry.until ? entry.note : null;
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
