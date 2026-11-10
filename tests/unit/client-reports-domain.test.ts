import { describe, expect, it } from "vitest";
import {
  buildSourceRows,
  firstMondayOf,
  isoWeekKey,
  lastFullMonth,
  lastFullWeek,
  monthLabelOf,
  monthlyStatus,
  monthlyWindowOpen,
  pointsDelta,
  roundedAvg,
  shortDay,
  weeklySummary,
  weeklyWindowOpen,
} from "@/server/domain/client-reports";

const at = (d: string) => new Date(`${d}T13:00:00Z`);

describe("semana", () => {
  it("el martes informa la semana que terminó el domingo", () => {
    const w = lastFullWeek(at("2026-11-10"));
    expect(w).toMatchObject({ from: "2026-11-02", to: "2026-11-08", prevFrom: "2026-10-26", prevTo: "2026-11-01", key: "2026-W45" });
    expect(w.label).toBe("2 al 8 de noviembre");
    expect(w.short).toBe("2 al 8 de nov");
    expect(w.endShort).toBe("8 de nov");
  });
  it("el lunes y el domingo cuentan igual que su semana", () => {
    expect(lastFullWeek(at("2026-11-09")).from).toBe("2026-11-02");
    expect(lastFullWeek(at("2026-11-15")).from).toBe("2026-11-02");
    expect(lastFullWeek(at("2026-11-16")).from).toBe("2026-11-09");
  });
  it("si cruza de mes lo dice con los dos meses", () => {
    const w = lastFullWeek(at("2026-11-02"));
    expect(w.label).toBe("26 de octubre al 1 de noviembre");
    expect(w.short).toBe("26 oct al 1 nov");
  });
  it("semana ISO, también al cruzar de año", () => {
    expect(isoWeekKey("2026-11-02")).toBe("2026-W45");
    expect(isoWeekKey("2026-01-01")).toBe("2026-W01");
    expect(isoWeekKey("2025-12-29")).toBe("2026-W01");
    expect(isoWeekKey("2027-01-03")).toBe("2026-W53");
  });
  it("sale lunes, martes o miércoles", () => {
    expect(["2026-11-09", "2026-11-10", "2026-11-11"].map((d) => weeklyWindowOpen(at(d)))).toEqual([true, true, true]);
    expect(["2026-11-12", "2026-11-14", "2026-11-15"].map((d) => weeklyWindowOpen(at(d)))).toEqual([false, false, false]);
  });
});

describe("mes", () => {
  it("el primer lunes informa el mes anterior completo", () => {
    expect(lastFullMonth(at("2026-11-02"))).toMatchObject({ from: "2026-10-01", to: "2026-10-31", prevFrom: "2026-09-01", prevTo: "2026-09-30", key: "2026-10", label: "octubre", prevLabel: "septiembre" });
  });
  it("en enero informa diciembre del año anterior; en marzo, febrero", () => {
    expect(lastFullMonth(at("2027-01-04"))).toMatchObject({ from: "2026-12-01", to: "2026-12-31", key: "2026-12", prevLabel: "noviembre" });
    expect(lastFullMonth(at("2026-03-02"))).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
    expect(lastFullMonth(at("2028-03-06"))).toMatchObject({ to: "2028-02-29" });
  });
  it("el primer lunes del mes", () => {
    expect(firstMondayOf("2026-11-20")).toBe("2026-11-02");
    expect(firstMondayOf("2026-06-30")).toBe("2026-06-01");
    expect(firstMondayOf("2027-01-31")).toBe("2027-01-04");
  });
  it("sale el primer lunes y los dos días siguientes, no antes ni después", () => {
    expect(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-09"].map((d) => monthlyWindowOpen(at(d)))).toEqual([false, true, true, true, false, false]);
    expect(monthlyWindowOpen(at("2026-06-01"))).toBe(true);
  });
  it("nombres y fechas cortas", () => {
    expect(monthLabelOf("2026-10")).toBe("octubre");
    expect(shortDay("2026-10-14")).toBe("14 oct");
  });
});

describe("orígenes de las visitas", () => {
  const channels = [
    { key: "Organic Search", sessions: 610 },
    { key: "Direct", sessions: 210 },
    { key: "Referral", sessions: 90 },
    { key: "Organic Social", sessions: 300 },
  ];
  const prevChannels = [
    { key: "Organic Search", sessions: 550 },
    { key: "Direct", sessions: 219 },
    { key: "Referral", sessions: 75 },
    { key: "Organic Social", sessions: 260 },
  ];
  it("separa las redes cuando hay datos por red y no cuenta dos veces el canal social", () => {
    const rows = buildSourceRows({
      channels,
      prevChannels,
      networks: [{ key: "instagram", sessions: 140 }, { key: "linkedin", sessions: 85 }, { key: "tiktok", sessions: 40 }, { key: "other", sessions: 35 }],
      prevNetworks: [{ key: "instagram", sessions: 128 }, { key: "linkedin", sessions: 65 }],
    });
    expect(rows.map((r) => r.label)).toEqual(["Buscadores (Google y otros)", "Directo o sin identificar", "Instagram", "Otros sitios", "LinkedIn", "TikTok", "Otras redes"]);
    expect(rows.reduce((n, r) => n + r.visits, 0)).toBe(610 + 210 + 90 + 300);
    const ig = rows.find((r) => r.label === "Instagram")!;
    expect(Math.round(ig.deltaPct!)).toBe(9);
    expect(rows.find((r) => r.label === "TikTok")!.deltaPct).toBeNull(); // sin visitas antes: «nuevo»
  });
  it("sin datos por red deja el canal social como un solo origen", () => {
    const rows = buildSourceRows({ channels, prevChannels, networks: [], prevNetworks: [] });
    expect(rows.map((r) => r.label)).toContain("Redes sociales (orgánico)");
    expect(rows).toHaveLength(4);
  });
  it("junta lo que pasa del tope en «Otros orígenes»", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ key: `Canal ${i}`, sessions: 100 - i }));
    const rows = buildSourceRows({ channels: many, prevChannels: [], networks: [], prevNetworks: [] });
    expect(rows).toHaveLength(9);
    expect(rows[8]!.label).toBe("Otros orígenes");
    expect(rows.reduce((n, r) => n + r.visits, 0)).toBe(many.reduce((n, r) => n + r.sessions, 0));
  });
});

describe("frases", () => {
  const rows = [
    { label: "Buscadores (Google y otros)", visits: 610, deltaPct: 3 },
    { label: "LinkedIn", visits: 85, deltaPct: 30 },
  ];
  it("semana con más visitas, menos o estable, sin atribuir causas", () => {
    expect(weeklySummary({ visits: 1240, visitsDeltaPct: 25, rows })).toBe("Semana con más visitas que la anterior. Lo que más creció: LinkedIn.");
    expect(weeklySummary({ visits: 900, visitsDeltaPct: -30, rows })).toBe("Semana con menos visitas que la anterior.");
    expect(weeklySummary({ visits: 1240, visitsDeltaPct: 8, rows })).toBe("Semana estable. Lo que más creció: LinkedIn.");
    expect(weeklySummary({ visits: 1240, visitsDeltaPct: 1, rows })).toBe("Semana estable. Origen principal: Buscadores (Google y otros).");
    expect(weeklySummary({ visits: 0, visitsDeltaPct: null, rows: [] })).toBe("Semana estable.");
  });
  it("el estado del mes: alertas abiertas mandan, luego la mejora del móvil, luego lo atendido", () => {
    expect(monthlyStatus({ openAlerts: 2, mobilePerfDelta: 9, actions: 3 })).toEqual({ tone: "attention", line: "Hay 2 puntos en revisión; los explico en el portal." });
    expect(monthlyStatus({ openAlerts: 1, mobilePerfDelta: 0, actions: 0 }).line).toBe("Hay un punto en revisión; lo explico en el portal.");
    expect(monthlyStatus({ openAlerts: 0, mobilePerfDelta: 5, actions: 3 })).toEqual({ tone: "ok", line: "Mejoró la velocidad en el móvil este mes y no quedan puntos abiertos." });
    expect(monthlyStatus({ openAlerts: 0, mobilePerfDelta: 1, actions: 3 }).line).toBe("Todo en orden: atendimos 3 cosas este mes y no quedan puntos abiertos.");
    expect(monthlyStatus({ openAlerts: 0, mobilePerfDelta: null, actions: 0 })).toEqual({ tone: "ok", line: "Todo en orden: no hubo incidencias." });
  });
  it("promedios y diferencias", () => {
    expect(roundedAvg([80, 91, null])).toBe(86);
    expect(roundedAvg([null])).toBeNull();
    expect(pointsDelta(78, 73)).toBe(5);
    expect(pointsDelta(null, 73)).toBeNull();
  });
});
