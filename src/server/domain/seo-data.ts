/**
 * Datos de búsqueda y tráfico del módulo SEO y visibilidad. Lógica pura: periodos, rangos de fechas, variaciones,
 * CTR, posición media y nombres legibles de países y dispositivos. Las fechas son cadenas «AAAA-MM-DD» (UTC).
 */

// ------------------------------------------------------------------ periodos

export const SEO_PERIODS = [7, 28, 90] as const;
export type SeoPeriod = (typeof SEO_PERIODS)[number];
export const DEFAULT_SEO_PERIOD: SeoPeriod = 28;

export const SEO_PERIOD_LABEL: Record<SeoPeriod, string> = { 7: "7 días", 28: "28 días", 90: "90 días" };

/** Periodo pedido en la dirección (`?dias=`). Acepta número o texto; cualquier otro valor da el de por defecto. */
export function parseSeoPeriod(raw: string | number | string[] | null | undefined): SeoPeriod {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === null || value === "") return DEFAULT_SEO_PERIOD;
  const n = typeof value === "number" ? value : /^\d+$/.test(value.trim()) ? Number(value.trim()) : Number.NaN;
  return (SEO_PERIODS as readonly number[]).includes(n) ? (n as SeoPeriod) : DEFAULT_SEO_PERIOD;
}

// ------------------------------------------------------------------- fechas

const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Día «AAAA-MM-DD» a milisegundos UTC. Lanza si el texto no es una fecha real. */
function toMs(date: string): number {
  const m = DATE_RE.exec(date);
  const ms = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : Number.NaN;
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== date) throw new RangeError(`Fecha no válida: ${date}`);
  return ms;
}

const toDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Suma (o resta, con negativos) días a una fecha «AAAA-MM-DD». */
export function addDays(date: string, days: number): string {
  return toDay(toMs(date) + days * DAY_MS);
}

/** Todos los días entre dos fechas, ambas incluidas, en orden. Vacío si `from` es posterior a `to`. */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let ms = toMs(from); ms <= toMs(to); ms += DAY_MS) out.push(toDay(ms));
  return out;
}

export type DateRange = { from: string; to: string; days: number };

/** Los `days` días que terminan en `end` (incluido). */
export function periodRange(end: string, days: number): DateRange {
  return { from: addDays(end, -(days - 1)), to: end, days };
}

/** El periodo inmediatamente anterior, de igual longitud, que termina el día antes de que empiece `range`. */
export function previousRange(range: DateRange): DateRange {
  return periodRange(addDays(range.from, -1), range.days);
}

/** Fecha más reciente de una lista (ignora vacíos); null si no hay ninguna. */
export function latestDate(dates: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  for (const d of dates) if (d && (best === null || d > best)) best = d;
  return best;
}

/** Una serie diaria completa: un punto por día del rango, con ceros donde no hubo datos. */
export function fillDays<T extends { date: string }>(range: { from: string; to: string }, rows: T[], empty: (date: string) => T): T[] {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  return eachDay(range.from, range.to).map((d) => byDate.get(d) ?? empty(d));
}

// ---------------------------------------------------------------- métricas

/** Variación porcentual frente al periodo anterior; null si el anterior es 0 (no hay base de comparación). */
export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

/** Porcentaje de clics sobre impresiones, como fracción (0,05 = 5 %). 0 si no hubo impresiones. */
export function ctr(clicks: number, impressions: number): number {
  return impressions > 0 ? clicks / impressions : 0;
}

/** Posición media ponderada por impresiones (suma de posición × impresiones ÷ impresiones); null sin impresiones. */
export function averagePosition(positionSum: number, impressions: number): number | null {
  return impressions > 0 ? positionSum / impressions : null;
}

// ------------------------------------------------------------- dispositivos

export const DEVICE_LABEL: Record<string, string> = { MOBILE: "Móvil", DESKTOP: "Escritorio", TABLET: "Tableta" };

export function deviceLabel(device: string): string {
  return DEVICE_LABEL[device.toUpperCase()] ?? device;
}

// ------------------------------------------------------------------ canales

/** Grupos de canal predeterminados de GA4, en español. Los que no se conocen se muestran tal como llegan. */
const CHANNEL_LABELS: Record<string, string> = {
  "organic search": "Búsqueda orgánica",
  "paid search": "Búsqueda de pago",
  direct: "Directo",
  referral: "Referencia",
  "organic social": "Redes sociales (orgánico)",
  "paid social": "Redes sociales (de pago)",
  "organic video": "Vídeo (orgánico)",
  "paid video": "Vídeo (de pago)",
  "organic shopping": "Compras (orgánico)",
  "paid shopping": "Compras (de pago)",
  email: "Correo electrónico",
  display: "Anuncios gráficos",
  affiliates: "Afiliados",
  audio: "Audio",
  sms: "SMS",
  "mobile push notifications": "Notificaciones push",
  "cross-network": "Varias redes",
  unassigned: "Sin asignar",
  "(other)": "Otros",
};

export function channelLabel(channel: string): string {
  return CHANNEL_LABELS[channel.trim().toLowerCase()] ?? channel;
}

// ----------------------------------------------------------------- países

/** Nombres en español de los códigos de tres letras (ISO 3166-1 alfa-3) que usa Search Console, en minúsculas. */
const COUNTRY_NAMES: Record<string, string> = {
  // América
  col: "Colombia",
  ven: "Venezuela",
  usa: "Estados Unidos",
  mex: "México",
  arg: "Argentina",
  chl: "Chile",
  per: "Perú",
  ecu: "Ecuador",
  bra: "Brasil",
  can: "Canadá",
  pan: "Panamá",
  cri: "Costa Rica",
  dom: "República Dominicana",
  ury: "Uruguay",
  pry: "Paraguay",
  bol: "Bolivia",
  gtm: "Guatemala",
  hnd: "Honduras",
  slv: "El Salvador",
  nic: "Nicaragua",
  cub: "Cuba",
  pri: "Puerto Rico",
  hti: "Haití",
  jam: "Jamaica",
  tto: "Trinidad y Tobago",
  bhs: "Bahamas",
  blz: "Belice",
  guy: "Guyana",
  sur: "Surinam",
  abw: "Aruba",
  cuw: "Curazao",
  // Europa
  esp: "España",
  prt: "Portugal",
  gbr: "Reino Unido",
  deu: "Alemania",
  fra: "Francia",
  ita: "Italia",
  nld: "Países Bajos",
  bel: "Bélgica",
  che: "Suiza",
  aut: "Austria",
  irl: "Irlanda",
  swe: "Suecia",
  nor: "Noruega",
  dnk: "Dinamarca",
  fin: "Finlandia",
  pol: "Polonia",
  cze: "Chequia",
  svk: "Eslovaquia",
  hun: "Hungría",
  rou: "Rumanía",
  bgr: "Bulgaria",
  grc: "Grecia",
  hrv: "Croacia",
  srb: "Serbia",
  svn: "Eslovenia",
  ukr: "Ucrania",
  rus: "Rusia",
  blr: "Bielorrusia",
  ltu: "Lituania",
  lva: "Letonia",
  est: "Estonia",
  isl: "Islandia",
  lux: "Luxemburgo",
  mlt: "Malta",
  cyp: "Chipre",
  and: "Andorra",
  // Asia y Oceanía
  chn: "China",
  jpn: "Japón",
  kor: "Corea del Sur",
  ind: "India",
  idn: "Indonesia",
  phl: "Filipinas",
  vnm: "Vietnam",
  tha: "Tailandia",
  mys: "Malasia",
  sgp: "Singapur",
  hkg: "Hong Kong",
  twn: "Taiwán",
  pak: "Pakistán",
  bgd: "Bangladés",
  lka: "Sri Lanka",
  npl: "Nepal",
  tur: "Turquía",
  isr: "Israel",
  sau: "Arabia Saudita",
  are: "Emiratos Árabes Unidos",
  qat: "Catar",
  kwt: "Kuwait",
  irn: "Irán",
  irq: "Irak",
  jor: "Jordania",
  lbn: "Líbano",
  kaz: "Kazajistán",
  aus: "Australia",
  nzl: "Nueva Zelanda",
  // África
  zaf: "Sudáfrica",
  egy: "Egipto",
  nga: "Nigeria",
  ken: "Kenia",
  mar: "Marruecos",
  dza: "Argelia",
  tun: "Túnez",
  gha: "Ghana",
  eth: "Etiopía",
  tza: "Tanzania",
  uga: "Uganda",
  sen: "Senegal",
  civ: "Costa de Marfil",
  cmr: "Camerún",
  ago: "Angola",
  gnq: "Guinea Ecuatorial",
  // Códigos especiales de Search Console
  zzz: "Región desconocida",
};

/** Nombre en español de un país a partir del código de Search Console; si no se conoce, el código en mayúsculas. */
export function countryName(code: string): string {
  const key = code.trim().toLowerCase();
  return COUNTRY_NAMES[key] ?? key.toUpperCase();
}

const GA4_COUNTRIES: Record<string, string> = {
  "United States": "Estados Unidos", Spain: "España", Mexico: "México", Peru: "Perú", Brazil: "Brasil", "United Kingdom": "Reino Unido",
  Canada: "Canadá", Germany: "Alemania", France: "Francia", Italy: "Italia", Panama: "Panamá", "Dominican Republic": "República Dominicana",
  Japan: "Japón", Netherlands: "Países Bajos", Switzerland: "Suiza", Belgium: "Bélgica", Ireland: "Irlanda", "New Zealand": "Nueva Zelanda",
  Russia: "Rusia", Turkey: "Turquía", Türkiye: "Turquía", Poland: "Polonia", Sweden: "Suecia", Norway: "Noruega", Denmark: "Dinamarca",
  Finland: "Finlandia", Greece: "Grecia", "South Korea": "Corea del Sur", Singapore: "Singapur", Philippines: "Filipinas", Thailand: "Tailandia",
  "United Arab Emirates": "Emiratos Árabes Unidos", "South Africa": "Sudáfrica", Egypt: "Egipto", Morocco: "Marruecos", Ukraine: "Ucrania",
  Romania: "Rumania", Czechia: "Chequia", Hungary: "Hungría", China: "China", "(not set)": "Sin identificar",
};

/** Nombre en español de un país tal como lo entrega GA4 (en inglés). Los que ya coinciden o no se conocen quedan igual. */
export function ga4CountryName(name: string): string {
  return GA4_COUNTRIES[name] ?? name;
}
