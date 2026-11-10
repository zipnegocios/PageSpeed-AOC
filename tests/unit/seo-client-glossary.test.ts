import { describe, expect, it } from "vitest";
import { SEO_CLIENT_GROUPS, SEO_CLIENT_TITLE } from "@/server/domain/seo-client-glossary";
import { ISSUE_CATALOG, ISSUE_CODES } from "@/server/domain/seo-crawl-rules";

describe("glosario de salud SEO para el cliente", () => {
  it("cubre todos los hallazgos del catálogo, con una frase que no es la técnica", () => {
    for (const code of ISSUE_CODES) {
      expect(SEO_CLIENT_TITLE[code], code).toBeTruthy();
      expect(SEO_CLIENT_TITLE[code], code).not.toBe(ISSUE_CATALOG[code].title);
    }
    expect(Object.keys(SEO_CLIENT_TITLE).sort()).toEqual([...ISSUE_CODES].sort());
  });

  it("los seis grupos del catálogo tienen nombre y no hay jerga en las frases", () => {
    expect(SEO_CLIENT_GROUPS.map((g) => g.group).sort()).toEqual([...new Set(ISSUE_CODES.map((c) => ISSUE_CATALOG[c].group))].sort());
    const text = Object.values(SEO_CLIENT_TITLE).join(" ");
    expect(text).not.toMatch(/hreflang|json-?ld|noindex|<link|rel=/i);
  });
});
