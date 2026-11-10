import { describe, expect, it } from "vitest";
import { aggregateQueries, aggregateSources, QUERIES_PER_DAY } from "@/server/domain/seo-sync";
import { classifySocial, networkOf, socialLabel, SOCIAL_SOURCE_REGEX } from "@/server/domain/seo-social";
import { classifySource, SOURCE_GROUPS, SOURCE_GROUP_LABEL, sourceLabel } from "@/server/domain/seo-sources";

describe("redes sociales: clasificación de la fuente de GA4", () => {
  it.each([
    ["facebook", "facebook"], ["m.facebook.com", "facebook"], ["l.facebook.com", "facebook"], ["lm.facebook.com", "facebook"], ["Facebook.com", "facebook"], ["fb", "facebook"], ["fb.me", "facebook"],
    ["instagram", "instagram"], ["l.instagram.com", "instagram"], ["ig", "instagram"],
    ["linkedin.com", "linkedin"], ["lnkd.in", "linkedin"], ["com.linkedin.android", "linkedin"],
    ["t.co", "x"], ["twitter", "x"], ["x.com", "x"], ["x", "x"],
    ["tiktok.com", "tiktok"], ["youtube.com", "youtube"], ["m.youtube.com", "youtube"], ["youtu.be", "youtube"],
    ["pinterest.com", "pinterest"], ["pin.it", "pinterest"], ["reddit.com", "reddit"], ["out.reddit.com", "reddit"],
    ["whatsapp", "whatsapp"], ["wa.me", "whatsapp"], ["web.whatsapp.com", "whatsapp"], ["t.me", "telegram"], ["telegram", "telegram"], ["threads.net", "threads"],
    ["https://www.facebook.com/", "facebook"], ["  INSTAGRAM  ", "instagram"],
  ])("%s → %s", (source, key) => {
    expect(classifySocial(source)?.key).toBe(key);
  });

  it("lo que no es de una red conocida no se clasifica (no hay falsos positivos por texto parecido)", () => {
    for (const source of ["google", "(direct)", "(not set)", "", "cart.com", "magazine.co.uk", "bing", "newsletter"]) expect(classifySocial(source), source).toBeNull();
  });

  it("una fuente desconocida que GA4 agrupa como social va a «Otras redes»; si no es social, se descarta", () => {
    expect(networkOf("mi-red.example", "Organic Social")).toBe("other");
    expect(networkOf("mi-red.example", "Referral")).toBeNull();
    expect(networkOf("whatsapp", "Referral")).toBe("whatsapp");
    expect(networkOf("youtube.com", "Organic Video")).toBe("youtube");
  });

  it("los nombres que ve el cliente y el filtro amplio", () => {
    expect(socialLabel("x")).toBe("X (Twitter)");
    expect(socialLabel("other")).toBe("Otras redes");
    expect(new RegExp(SOCIAL_SOURCE_REGEX, "i").test("m.FACEBOOK.com")).toBe(true);
  });
});

describe("reparto completo de fuentes", () => {
  it.each([
    ["google", "Organic Search", "search", "google"], ["bing", "Organic Search", "search", "bing"], ["duckduckgo", "Organic Search", "search", "duckduckgo"], ["www.google.com.co", "Organic Search", "search", "google"], ["raro.example", "Organic Search", "search", "other"],
    ["(direct)", "Direct", "direct", "direct"], ["(not set)", "Unassigned", "direct", "direct"], ["", "Direct", "direct", "direct"],
    ["l.instagram.com", "Organic Social", "social", "instagram"], ["whatsapp", "Referral", "social", "whatsapp"], ["mi-red.example", "Paid Social", "social", "other"],
    ["chatgpt.com", "Referral", "ai", "chatgpt"], ["perplexity.ai", "Referral", "ai", "perplexity"],
    ["mailchimp", "Email", "email", "email"], ["google", "Paid Search", "paid", "paid"], ["red.example", "Display", "paid", "paid"],
    ["blog.otro.com", "Referral", "referral", "blog.otro.com"], ["https://www.directorio.com/x", "Referral", "referral", "directorio.com"],
    ["algo", "(other)", "other", "algo"],
  ])("%s (%s) → %s · %s", (source, channel, group, key) => {
    expect(classifySource(source, channel)).toEqual({ group, key });
  });

  it("cada grupo tiene nombre y los nombres concretos se leen bien", () => {
    expect(SOURCE_GROUPS.every((g) => Boolean(SOURCE_GROUP_LABEL[g]))).toBe(true);
    expect(sourceLabel("search", "google")).toBe("Google");
    expect(sourceLabel("search", "other")).toBe("Otros buscadores");
    expect(sourceLabel("social", "linkedin")).toBe("LinkedIn");
    expect(sourceLabel("direct", "direct")).toBe("Directo o sin identificar");
    expect(sourceLabel("ai", "chatgpt")).toBe("ChatGPT");
    expect(sourceLabel("referral", "blog.otro.com")).toBe("blog.otro.com");
  });

  const row = (source: string, channel: string, page: string, sessions: number, users = sessions, date = "20261109") => ({ dims: { date, sessionSource: source, sessionDefaultChannelGroup: channel, pagePath: page }, metrics: { sessions, totalUsers: users } });

  it("aggregateSources: cada fila va a un grupo, suma las fuentes de una misma red y la suma total no cambia", () => {
    const input = [
      row("m.facebook.com", "Organic Social", "/precios/", 3),
      row("lm.facebook.com", "Organic Social", "/precios?x=1", 2),
      row("l.instagram.com", "Organic Social", "/", 4, 3),
      row("google", "Organic Search", "/", 10),
      row("(direct)", "Direct", "/", 5),
      row("cart.com", "Referral", "/", 9),
    ];
    const out = aggregateSources(input);
    const key = (r: { grp: string; source: string; page: string }) => `${r.grp}|${r.source}|${r.page}`;
    expect(out.map(key).sort()).toEqual(["direct|direct|/", "referral|cart.com|/", "search|google|/", "social|facebook|/precios", "social|instagram|/"]);
    expect(out.find((r) => r.source === "facebook")).toMatchObject({ date: "2026-11-09", sessions: 5, users: 5 });
    expect(out.reduce((a, r) => a + r.sessions, 0)).toBe(input.reduce((a, r) => a + r.metrics.sessions, 0)); // el reparto suma el 100 %
    expect(aggregateSources([])).toEqual([]);
  });
});

describe("aggregateQueries", () => {
  const rec = (date: string, query: string, clicks: number, impressions: number, position: number) => ({ keys: { date, query }, clicks, impressions, position });

  it("normaliza la consulta, suma duplicados, pondera la posición y guarda solo las de más clics de cada día", () => {
    const out = aggregateQueries([rec("2026-11-01", "Grúa  Torre", 3, 30, 4), rec("2026-11-01", "grúa torre", 1, 10, 8), rec("2026-11-01", "", 5, 5, 1), rec("2026-11-02", "otra", 2, 20, 3)]);
    expect(out).toContainEqual({ date: "2026-11-01", query: "grúa torre", clicks: 4, impressions: 40, positionSum: 4 * 30 + 8 * 10 });
    expect(out).toHaveLength(2);
    const many = Array.from({ length: QUERIES_PER_DAY + 20 }, (_, i) => rec("2026-11-03", `consulta ${i}`, 100 - i, 10, 1));
    const kept = aggregateQueries(many);
    expect(kept).toHaveLength(QUERIES_PER_DAY);
    expect(kept[0]!.query).toBe("consulta 0");
  });
});
