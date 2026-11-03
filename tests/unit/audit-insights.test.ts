import { describe, expect, it } from "vitest";
import failing from "../fixtures/lhr-failing.json";
import { getAuditInsights } from "@/server/services/audits";

const r2 = (impl: () => Promise<unknown>) => ({ getAuditJson: impl as never });

describe("getAuditInsights", () => {
  it("devuelve mejoras y comprobaciones fallidas con una sola lectura", async () => {
    let reads = 0;
    const out = await getAuditInsights({ status: "succeeded", r2Key: "k" }, r2(async () => (reads++, failing)));
    expect(reads).toBe(1);
    expect(out!.failed.find((c) => c.category === "seo")!.failedCount).toBe(2);
    expect(Array.isArray(out!.opportunities)).toBe(true);
  });

  it("devuelve null si no hay informe o R2 falla", async () => {
    expect(await getAuditInsights({ status: "failed", r2Key: null }, r2(async () => failing))).toBeNull();
    expect(await getAuditInsights({ status: "succeeded", r2Key: "k" }, r2(async () => { throw new Error("r2"); }))).toBeNull();
  });
});
