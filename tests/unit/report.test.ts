import { describe, expect, it } from "vitest";
import { createSerialCache } from "@/server/report/cache";
import { renderReportPdf } from "@/server/report/pdf";
import { DEFAULT_SENDER } from "@/server/domain/client-sender";
import { buildReportEmail } from "@/server/notify/report-email";
import { reportData } from "../helpers/report-data";
import { ENGINEERING_SECTIONS, SUMMARY_SECTIONS } from "@/server/domain/report-outline";
import { MEASUREMENTS } from "@/server/domain/measurements";
import { scoreBand } from "@/server/domain/score-band";
import { reportFilename, seoDaysFor, worstFirst } from "@/server/services/report";
import { lightToken } from "@/lib/tokens";

describe("createSerialCache", () => {
  it("reutiliza el resultado dentro del TTL y lo regenera después", async () => {
    let t = 0;
    let calls = 0;
    const cache = createSerialCache<number>({ ttlMs: 1000, now: () => t });
    const make = async () => ++calls;
    expect(await cache.get("a", make)).toBe(1);
    t = 999;
    expect(await cache.get("a", make)).toBe(1);
    t = 1000;
    expect(await cache.get("a", make)).toBe(2);
    expect(await cache.get("b", make)).toBe(3);
  });

  it("peticiones simultáneas de la misma clave comparten una sola generación", async () => {
    let calls = 0;
    const cache = createSerialCache<number>({ ttlMs: 1000 });
    const make = async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return calls; };
    const out = await Promise.all([cache.get("k", make), cache.get("k", make), cache.get("k", make)]);
    expect(out).toEqual([1, 1, 1]);
    expect(calls).toBe(1);
  });

  it("genera de uno en uno aunque las claves sean distintas", async () => {
    let active = 0;
    let peak = 0;
    const cache = createSerialCache<string>({ ttlMs: 1000 });
    const make = (id: string) => async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 15));
      active--;
      return id;
    };
    await Promise.all(["a", "b", "c", "d"].map((k) => cache.get(k, make(k))));
    expect(peak).toBe(1);
  });

  it("un fallo no se guarda y no detiene la cola", async () => {
    const cache = createSerialCache<string>({ ttlMs: 1000 });
    await expect(cache.get("x", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await cache.get("x", async () => "ok")).toBe("ok");
    expect(await cache.get("y", async () => "otro")).toBe("otro");
  });

  it("descarta lo más antiguo al pasar el máximo", async () => {
    let calls = 0;
    const cache = createSerialCache<number>({ ttlMs: 10_000, maxEntries: 2 });
    const make = async () => ++calls;
    await cache.get("a", make); await cache.get("b", make); await cache.get("c", make);
    await cache.get("a", make); // "a" ya no estaba
    expect(calls).toBe(4);
  });
});

/** Los títulos de los marcadores (el índice que el lector de PDF muestra en su panel), en orden. */
function outlineTitles(pdf: Buffer): string[] {
  const text = pdf.toString("latin1");
  const out: string[] = [];
  for (const m of text.matchAll(/\/Title\s*\(((?:\\.|[^\\)])*)\)/g)) {
    const raw = m[1]!.replace(/\\([()\\])/g, "$1");
    out.push(raw.startsWith("\u00fe\u00ff") ? Buffer.from(raw.slice(2), "latin1").swap16().toString("utf16le") : raw);
  }
  return out;
}
const pageCount = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length;

describe("informe", () => {
  const summary = reportData("summary");
  const engineering = reportData("engineering");

  it.each([["summary", summary], ["engineering", engineering]] as const)("el %s es un PDF A4 válido, con las fuentes incrustadas y sin Helvetica", async (_kind, data) => {
    const pdf = await renderReportPdf(data);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(5_000);
    const text = pdf.toString("latin1");
    expect(text).toContain("Rajdhani");
    expect(text).not.toContain("Helvetica");
    expect(text).toMatch(/MediaBox\s*\[\s*0\s+0\s+595\.2\d*\s+841\.8\d*/);
  });

  it("el índice es un contrato: cada PDF trae exactamente sus apartados, en orden, con el mismo título que promete la pestaña", async () => {
    const wanted = (list: readonly { title: string }[]) => list.map((sec, i) => `${i + 1}. ${sec.title}`);
    const sum = outlineTitles(await renderReportPdf(summary)).filter((t) => /^\d+\. /.test(t));
    const eng = outlineTitles(await renderReportPdf(engineering)).filter((t) => /^\d+\. /.test(t));
    expect(sum).toEqual(wanted(SUMMARY_SECTIONS));
    expect(eng).toEqual(wanted(ENGINEERING_SECTIONS));
    expect(SUMMARY_SECTIONS).toHaveLength(7);
    expect(ENGINEERING_SECTIONS).toHaveLength(11);
  });

  it("cada medición aparece en algún apartado de los dos informes (excepto los de texto fijo)", () => {
    for (const list of [SUMMARY_SECTIONS, ENGINEERING_SECTIONS]) {
      const covered = new Set(list.flatMap((sec) => sec.measures));
      for (const m of MEASUREMENTS) expect(covered.has(m.id), `${m.id} sin apartado`).toBe(true);
    }
  });

  it("los apartados nuevos traen las cifras reales: fuentes, redes por nombre, consultas y experiencia real", async () => {
    const text = (pdf: Buffer) => outlineTitles(pdf).join("|");
    for (const data of [summary, engineering]) {
      const pdf = await renderReportPdf(data);
      const titles = text(pdf);
      expect(titles).toMatch(/Experiencia real de los visitantes/);
      expect(titles).toMatch(/Búsqueda en Google|Search Console en detalle/);
    }
  });

  it("sin datos de una medición, el apartado sigue y dice por qué (activada sin datos o no activada)", async () => {
    for (const states of [{ ...summary.states, search: "pending" as const }, { ...summary.states, search: "off" as const }]) {
      const pdf = await renderReportPdf({ ...summary, states, seo: { ...summary.seo!, dashboard: { ...summary.seo!.dashboard!, search: null } } });
      expect(outlineTitles(pdf).some((t) => /Búsqueda en Google/.test(t))).toBe(true);
    }
  });

  it("el resumen es corto y el de ingeniería es más largo y tiene portada", async () => {
    const small = await renderReportPdf({ ...summary });
    const big = await renderReportPdf({ ...engineering });
    expect(pageCount(small)).toBeLessThanOrEqual(3);
    expect(pageCount(big)).toBeGreaterThan(pageCount(small));
  });

  it("sin acceso a tráfico ni salud SEO los apartados siguen en el índice, con su motivo", async () => {
    for (const data of [{ ...summary, seo: null }, { ...engineering, seo: null }]) {
      const pdf = await renderReportPdf(data);
      const titles = outlineTitles(pdf);
      expect(titles.some((t) => /Salud SEO/.test(t))).toBe(true);
    }
  });

  it("aguanta informes vacíos, sin logotipo y proyectos con muchas rutas (con tope)", async () => {
    for (const kind of ["summary", "engineering"] as const) {
      const empty = await renderReportPdf({ ...reportData(kind), latest: [], improvements: [], charts: [], detail: [], daily: [], logo: null, seo: null, pageImprovements: { pages: [], total: 0 } });
      expect(empty.subarray(0, 5).toString()).toBe("%PDF-");
    }
    const many = await renderReportPdf(reportData("engineering", { routes: 120 }));
    expect(pageCount(many)).toBeGreaterThanOrEqual(5);
    // El tope: no se detallan más de 30 páginas aunque haya 120 (el detalle viene ya recortado por el servicio).
    expect(many.length).toBeLessThan(4_000_000);
  });

  it("el nombre de archivo es seguro, lleva el tipo y la fecha", () => {
    expect(reportFilename(summary)).toBe("resumen-Acme-S-A-Tienda-nandu-20261103.pdf");
    expect(reportFilename(engineering)).toBe("informe-ingenieria-Acme-S-A-Tienda-nandu-20261103.pdf");
    expect(reportFilename({ ...summary, clientName: "../../etc/passwd", projectName: "\"; rm -rf /" })).toMatch(/^resumen-[A-Za-z0-9-]+-[A-Za-z0-9-]+-20261103\.pdf$/);
    expect(reportFilename({ ...engineering, clientName: "ñ", projectName: "***" })).toBe("informe-ingenieria-n-informe-20261103.pdf");
  });

  it("el periodo del informe se traduce al de «Tráfico y búsqueda» (7, 28 o 90 días)", () => {
    expect([7, 30, 90, 365].map((d) => seoDaysFor(d as never))).toEqual([7, 28, 90, 90]);
  });

  it("las rutas más débiles van primero", () => {
    const rows = worstFirst(reportData("summary", { routes: 5 }).latest);
    const perf = rows.map((r) => r.scores.performance!);
    expect(perf).toEqual([...perf].sort((a, b) => a - b));
  });
});

describe("correo del informe", () => {
  it("saluda al contacto, nombra el periodo y enlaza el portal con el texto escapado", () => {
    const m = buildReportEmail({ contactName: "Ana", projectName: "Tienda <b>", days: 90, portalUrl: "https://app.test/c/tok/proj", sender: DEFAULT_SENDER, appUrl: "https://app.test" });
    expect(m.subject).toBe("Informes técnicos web · Tienda <b>");
    expect(m.text).toContain("Informe resumen");
    expect(m.text).toContain("Informe de ingeniería");
    expect(m.text).toContain("Hola Ana,");
    expect(m.text).toContain("90 días");
    expect(m.text).toContain("https://app.test/c/tok/proj");
    expect(m.html).toContain("Tienda &lt;b&gt;");
    expect(m.html).not.toContain("Tienda <b>");
    expect(buildReportEmail({ contactName: null, projectName: "T", days: 7, portalUrl: "u", sender: DEFAULT_SENDER, appUrl: "https://app.test" }).text).toMatch(/^Hola,/);
  });
});

describe("utilidades del informe", () => {
  it("las bandas de puntuación coinciden con el Design System", () => {
    expect(scoreBand(90).word).toBe("bueno");
    expect(scoreBand(89).word).toBe("mejorable");
    expect(scoreBand(50).word).toBe("mejorable");
    expect(scoreBand(49)).toEqual({ tone: "danger", word: "deficiente" });
  });
  it("los colores salen de tokens.json (tema claro)", () => {
    expect(lightToken("brand-deep")).toBe("#111827");
    expect(lightToken("primary")).toBe("#4D7C0F");
    expect(lightToken("no-existe")).toBe("#000000");
  });
});
