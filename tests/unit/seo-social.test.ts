import { describe, expect, it } from "vitest";
import { aggregateSocial } from "@/server/domain/seo-sync";
import { classifySocial, networkOf, socialLabel, SOCIAL_SOURCE_REGEX } from "@/server/domain/seo-social";
import { socialSourceFilter } from "@/server/seo/ga4";

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
    for (const source of ["google", "(direct)", "(not set)", "", "cart.com", "magazine.co.uk", "bing", "newsletter", "tiktoker-blog.com.x.example".replace("tiktoker-", "")]) {
      expect(classifySocial(source), source).toBeNull();
    }
  });

  it("una fuente desconocida que GA4 agrupa como social va a «Otras redes»; si no es social, se descarta", () => {
    expect(networkOf("mi-red.example", "Organic Social")).toBe("other");
    expect(networkOf("mi-red.example", "Paid Social")).toBe("other");
    expect(networkOf("mi-red.example", "Referral")).toBeNull();
    expect(networkOf("cart.com", "Referral")).toBeNull();
    // WhatsApp llega a veces como «referido»: se reconoce por su fuente.
    expect(networkOf("whatsapp", "Referral")).toBe("whatsapp");
    expect(networkOf("youtube.com", "Organic Video")).toBe("youtube");
  });

  it("los nombres que ve el cliente", () => {
    expect(socialLabel("x")).toBe("X (Twitter)");
    expect(socialLabel("linkedin")).toBe("LinkedIn");
    expect(socialLabel("other")).toBe("Otras redes");
    expect(socialLabel("inexistente")).toBe("Otras redes");
  });

  it("el filtro de GA4 es amplio (grupo de canal o fuente) y la consulta lo lleva en un `orGroup`", () => {
    const exprs = socialSourceFilter.orGroup.expressions;
    expect(exprs).toHaveLength(2);
    expect(exprs[0]!.filter.fieldName).toBe("sessionDefaultChannelGroup");
    expect((exprs[0]!.filter as { inListFilter: { values: string[] } }).inListFilter.values).toEqual(["Organic Social", "Paid Social", "Organic Video"]);
    expect(new RegExp(SOCIAL_SOURCE_REGEX, "i").test("m.FACEBOOK.com")).toBe(true);
  });
});

describe("aggregateSocial", () => {
  const row = (source: string, channel: string, page: string, sessions: number, users = sessions, date = "20261109") => ({ dims: { date, sessionSource: source, sessionDefaultChannelGroup: channel, pagePath: page }, metrics: { sessions, totalUsers: users } });

  it("suma las fuentes de una misma red, normaliza la página y la fecha, y descarta lo que no es social", () => {
    const out = aggregateSocial([
      row("m.facebook.com", "Organic Social", "/precios/", 3),
      row("lm.facebook.com", "Organic Social", "/precios?x=1", 2),
      row("l.instagram.com", "Organic Social", "/", 4, 3),
      row("mi-red.example", "Organic Social", "/", 1),
      row("cart.com", "Referral", "/", 9),
    ]);
    const byKey = Object.fromEntries(out.map((r) => [`${r.network}|${r.page}`, r]));
    expect(Object.keys(byKey).sort()).toEqual(["facebook|/precios", "instagram|/", "other|/"]);
    expect(byKey["facebook|/precios"]).toMatchObject({ date: "2026-11-09", sessions: 5, users: 5 });
    expect(byKey["instagram|/"]).toMatchObject({ sessions: 4, users: 3 });
  });

  it("sin filas no hay nada", () => {
    expect(aggregateSocial([])).toEqual([]);
  });
});
