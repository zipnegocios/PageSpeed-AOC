/**
 * Periodos, filas y frases de los correos automáticos al cliente («Tu semana en la web» y «Estado general»). Lógica pura:
 * sin base de datos ni red. Las fechas son «AAAA-MM-DD» en UTC.
 */
import { addDays, percentChange } from "./seo-data";
import { channelLabel } from "./seo-data";
import { SOCIAL_CHANNEL_GROUPS, socialLabel } from "./seo-social";

const DAY_MS = 86_400_000;
const toMs = (date: string) => Date.parse(`${date}T00:00:00Z`);
const toDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const todayOf = (now: Date) => now.toISOString().slice(0, 10);
/** 0 = lunes … 6 = domingo. */
const weekdayOf = (date: string) => (new Date(toMs(date)).getUTCDay() + 6) % 7;

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const SHORT_MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const dayNum = (date: string) => Number(date.slice(8, 10));
const monthIdx = (date: string) => Number(date.slice(5, 7)) - 1;

// ------------------------------------------------------------------- semana

export type WeekPeriod = {
  /** Lunes y domingo de la semana que se informa. */
  from: string;
  to: string;
  /** La semana anterior, para comparar. */
  prevFrom: string;
  prevTo: string;
  /** «2026-W45» (semana ISO del lunes). */
  key: string;
  /** «2 al 8 de noviembre». */
  label: string;
  /** «2 al 8 de nov». */
  short: string;
  /** «8 de nov». */
  endShort: string;
};

/** Semana ISO («2026-W45») de una fecha. */
export function isoWeekKey(date: string): string {
  const d = new Date(toMs(date));
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow + 3); // el jueves de esa semana fija el año ISO
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((d.getTime() - jan4.getTime()) / DAY_MS - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** La última semana completa (lunes a domingo) que termina antes de `now`. */
export function lastFullWeek(now: Date): WeekPeriod {
  const today = todayOf(now);
  const monday = addDays(today, -weekdayOf(today));
  const from = addDays(monday, -7);
  const to = addDays(monday, -1);
  const sameMonth = monthIdx(from) === monthIdx(to);
  const label = sameMonth
    ? `${dayNum(from)} al ${dayNum(to)} de ${MONTHS[monthIdx(to)]}`
    : `${dayNum(from)} de ${MONTHS[monthIdx(from)]} al ${dayNum(to)} de ${MONTHS[monthIdx(to)]}`;
  const short = sameMonth
    ? `${dayNum(from)} al ${dayNum(to)} de ${SHORT_MONTHS[monthIdx(to)]}`
    : `${dayNum(from)} ${SHORT_MONTHS[monthIdx(from)]} al ${dayNum(to)} ${SHORT_MONTHS[monthIdx(to)]}`;
  return {
    from,
    to,
    prevFrom: addDays(from, -7),
    prevTo: addDays(from, -1),
    key: isoWeekKey(from),
    label,
    short,
    endShort: `${dayNum(to)} de ${SHORT_MONTHS[monthIdx(to)]}`,
  };
}

/** El correo semanal sale lunes, martes o miércoles (UTC): los días siguientes dan margen a que lleguen los datos de GA4. */
export function weeklyWindowOpen(now: Date): boolean {
  return weekdayOf(todayOf(now)) <= 2;
}

// --------------------------------------------------------------------- mes

export type MonthPeriod = {
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  /** «2026-10». */
  key: string;
  /** «octubre». */
  label: string;
  prevLabel: string;
};

/** El último mes completo antes de `now`. */
export function lastFullMonth(now: Date): MonthPeriod {
  const today = todayOf(now);
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)) - 1; // mes actual, 0-based
  const first = Date.UTC(y, m - 1, 1);
  const last = Date.UTC(y, m, 0);
  const prevFirst = Date.UTC(y, m - 2, 1);
  const prevLast = Date.UTC(y, m - 1, 0);
  const idx = new Date(first).getUTCMonth();
  return {
    from: toDay(first),
    to: toDay(last),
    prevFrom: toDay(prevFirst),
    prevTo: toDay(prevLast),
    key: toDay(first).slice(0, 7),
    label: MONTHS[idx]!,
    prevLabel: MONTHS[new Date(prevFirst).getUTCMonth()]!,
  };
}

/** El primer lunes del mes de `date`. */
export function firstMondayOf(date: string): string {
  const first = `${date.slice(0, 7)}-01`;
  return addDays(first, (7 - weekdayOf(first)) % 7);
}

/** El correo mensual sale el primer lunes del mes o en los dos días siguientes. */
export function monthlyWindowOpen(now: Date): boolean {
  const today = todayOf(now);
  const monday = firstMondayOf(today);
  return today >= monday && today <= addDays(monday, 2);
}

/** El mes en español que corresponde a una clave «AAAA-MM». */
export function monthLabelOf(key: string): string {
  return MONTHS[Number(key.slice(5, 7)) - 1] ?? key;
}

/** «14 oct» para el registro de actuaciones. */
export function shortDay(date: string): string {
  return `${dayNum(date)} ${SHORT_MONTHS[monthIdx(date)]}`;
}

// --------------------------------------------------------- orígenes de visitas

export type SourceRow = { label: string; visits: number; deltaPct: number | null };
export type SessionsBy = Array<{ key: string; sessions: number }>;

const SOCIAL_GROUPS = new Set((SOCIAL_CHANNEL_GROUPS as readonly string[]).map((g) => g.toLowerCase()));
const isSocialChannel = (channel: string) => SOCIAL_GROUPS.has(channel.trim().toLowerCase());

/** Cómo se nombran en el correo los canales de GA4 que lo piden distinto al panel. */
const EMAIL_CHANNEL_LABEL: Record<string, string> = {
  "organic search": "Buscadores (Google y otros)",
  direct: "Directo o sin identificar",
  referral: "Otros sitios",
};
const emailChannelLabel = (channel: string) => EMAIL_CHANNEL_LABEL[channel.trim().toLowerCase()] ?? channelLabel(channel);

export const MAX_SOURCE_ROWS = 9;

/**
 * Los orígenes de las visitas para el correo. Los canales que no son redes sociales van como llegan de GA4; las redes
 * sociales se separan por red (Instagram, LinkedIn…) cuando hay datos por fuente, y si no, van como un solo canal. Lo que
 * sobra del tope se junta en «Otros orígenes». Variación frente al periodo anterior: null si antes no había visitas.
 */
export function buildSourceRows(input: { channels: SessionsBy; prevChannels: SessionsBy; networks: SessionsBy; prevNetworks: SessionsBy }): SourceRow[] {
  const useNetworks = input.networks.reduce((n, r) => n + r.sessions, 0) > 0;
  const entries = (channels: SessionsBy, networks: SessionsBy): Map<string, { label: string; visits: number }> => {
    const out = new Map<string, { label: string; visits: number }>();
    const add = (id: string, label: string, visits: number) => {
      if (visits <= 0) return;
      const cur = out.get(id);
      out.set(id, { label, visits: (cur?.visits ?? 0) + visits });
    };
    for (const c of channels) {
      if (useNetworks && isSocialChannel(c.key)) continue;
      add(`c:${c.key.trim().toLowerCase()}`, emailChannelLabel(c.key), c.sessions);
    }
    if (useNetworks) for (const n of networks) add(`n:${n.key}`, socialLabel(n.key), n.sessions);
    return out;
  };
  const current = entries(input.channels, input.networks);
  const before = entries(input.prevChannels, input.prevNetworks);
  const rows = [...current.entries()]
    .map(([id, v]) => ({ id, label: v.label, visits: v.visits, deltaPct: percentChange(v.visits, before.get(id)?.visits ?? 0) }))
    .sort((a, b) => b.visits - a.visits || a.label.localeCompare(b.label, "es"));
  if (rows.length <= MAX_SOURCE_ROWS) return rows.map(({ label, visits, deltaPct }) => ({ label, visits, deltaPct }));
  const head = rows.slice(0, MAX_SOURCE_ROWS - 1);
  const rest = rows.slice(MAX_SOURCE_ROWS - 1);
  const restNow = rest.reduce((n, r) => n + r.visits, 0);
  const restBefore = rest.reduce((n, r) => n + (before.get(r.id)?.visits ?? 0), 0);
  return [...head.map(({ label, visits, deltaPct }) => ({ label, visits, deltaPct })), { label: "Otros orígenes", visits: restNow, deltaPct: percentChange(restNow, restBefore) }];
}

/** Variación de las visitas desde las redes (por origen) que pasa de este umbral se menciona como lo que más subió. */
const RISE_MIN_VISITS = 20;

/**
 * Frase del cuadro «En una línea»: describe lo medido, nunca atribuye una causa. Tres casos: subida, bajada y estable.
 */
export function weeklySummary(input: { visits: number; visitsDeltaPct: number | null; rows: SourceRow[] }): string {
  const top = input.rows[0];
  const riser = [...input.rows].filter((r) => r.deltaPct !== null && r.deltaPct > 0 && r.visits >= RISE_MIN_VISITS).sort((a, b) => b.visits * (b.deltaPct ?? 0) - a.visits * (a.deltaPct ?? 0))[0];
  const delta = input.visitsDeltaPct;
  const grew = riser ? ` Lo que más creció: ${riser.label}.` : "";
  if (delta !== null && delta >= 20) return `Semana con más visitas que la anterior.${grew}`;
  if (delta !== null && delta <= -20) return "Semana con menos visitas que la anterior.";
  if (riser && delta !== null && delta >= 5) return `Semana estable.${grew}`;
  return top ? `Semana estable. Origen principal: ${top.label}.` : "Semana estable.";
}

// ----------------------------------------------------------------- estado del mes

/** Una subida de la velocidad en móvil de este tamaño (puntos) se menciona en el estado del mes. */
const MOBILE_GAIN_POINTS = 3;

export type MonthStatus = { tone: "ok" | "attention"; line: string };

/** Frase y tono del estado del mes, por reglas: nunca la redacta una IA. */
export function monthlyStatus(input: { openAlerts: number; mobilePerfDelta: number | null; actions: number }): MonthStatus {
  if (input.openAlerts > 0) {
    return {
      tone: "attention",
      line: input.openAlerts === 1 ? "Hay un punto en revisión; lo explico en el portal." : `Hay ${input.openAlerts} puntos en revisión; los explico en el portal.`,
    };
  }
  if (input.mobilePerfDelta !== null && input.mobilePerfDelta >= MOBILE_GAIN_POINTS) {
    return { tone: "ok", line: "Mejoró la velocidad en el móvil este mes y no quedan puntos abiertos." };
  }
  if (input.actions > 0) {
    return { tone: "ok", line: input.actions === 1 ? "Todo en orden: atendí una cosa este mes y no quedan puntos abiertos." : `Todo en orden: atendí ${input.actions} cosas este mes y no quedan puntos abiertos.` };
  }
  return { tone: "ok", line: "Todo en orden: no hubo incidencias." };
}

/** Promedio redondeado a entero; null si no hay datos. */
export function roundedAvg(values: Array<number | null>): number | null {
  const v = values.filter((x): x is number => x !== null);
  return v.length === 0 ? null : Math.round(v.reduce((a, b) => a + b, 0) / v.length);
}

/** Diferencia en puntos entre dos promedios; null si falta alguno. */
export function pointsDelta(now: number | null, before: number | null): number | null {
  return now === null || before === null ? null : now - before;
}
