import { describe, expect, it } from "vitest";
import { conditionSummary, developmentConditions } from "@/server/domain/dev-conditions";

const at = new Date("2026-11-10T12:00:00Z");
const l = (path: string, profile: "mobile" | "desktop", p: number | null, s: number | null = 95) => ({ path, profile, finishedAt: at, scores: { performance: p, seo: s, accessibility: 100, best_practices: 100 } });
const t = (metric: "performance" | "seo" | "accessibility" | "best_practices", minScore: number, enabled = true) => ({ metric, minScore, enabled });

describe("mejoras de un proyecto en desarrollo", () => {
  it("cada rubro por debajo de su meta, por página y dispositivo, es una mejora", () => {
    const out = developmentConditions([l("/", "mobile", 60), l("/", "desktop", 90), l("/blog", "mobile", 70, 80)], [t("performance", 85), t("seo", 90)]);
    expect(out.map((c) => `${c.routePath}|${c.profile}|${c.metric}|${c.value}`)).toEqual(["/|mobile|performance|60", "/blog|mobile|performance|70", "/blog|mobile|seo|80"]);
    expect(out.every((c) => c.kind === "threshold" && c.openedAt === at)).toBe(true);
  });

  it("estar justo en la meta no cuenta; una meta apagada o un rubro sin nota se ignoran; sin metas no hay mejoras", () => {
    expect(developmentConditions([l("/", "mobile", 85)], [t("performance", 85)])).toEqual([]);
    expect(developmentConditions([l("/", "mobile", 10)], [t("performance", 85, false)])).toEqual([]);
    expect(developmentConditions([l("/", "mobile", null)], [t("performance", 85)])).toEqual([]);
    expect(developmentConditions([l("/", "mobile", 10)], [])).toEqual([]);
  });

  it("el texto corto es el mismo que el de las alertas", () => {
    expect(conditionSummary({ metric: "seo", value: 69, threshold: 90 })).toBe("SEO 69 (mínimo 90)");
    expect(conditionSummary({ metric: null, value: null, threshold: null })).toBe("la auditoría falla");
  });
});
