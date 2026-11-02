import { describe, expect, it } from "vitest";
import { errorCode, runChecks } from "@/server/services/health";

describe("runChecks", () => {
  it("devuelve el estado de cada comprobación, en paralelo", async () => {
    const started = Date.now();
    const results = await runChecks({
      postgres: async () => {
        await new Promise((r) => setTimeout(r, 120));
      },
      redis: async () => {
        throw Object.assign(new Error("boom"), { code: "ECONNREFUSED" });
      },
    });
    expect(Date.now() - started).toBeLessThan(230);
    expect(results.find((r) => r.name === "postgres")).toMatchObject({ ok: true });
    expect(results.find((r) => r.name === "redis")).toMatchObject({ ok: false, error: "ECONNREFUSED" });
  });

  it("corta una comprobación colgada con TIMEOUT sin bloquear a las demás", async () => {
    const results = await runChecks(
      { r2: () => new Promise<void>(() => undefined), smtp: async () => undefined },
      60,
    );
    expect(results.find((r) => r.name === "r2")).toMatchObject({ ok: false, error: "TIMEOUT" });
    expect(results.find((r) => r.name === "smtp")).toMatchObject({ ok: true });
  });

  it("nunca filtra el mensaje original del error", async () => {
    const secret = "postgres://usuario:CLAVE-SECRETA@host-interno:5432/db";
    const [r] = await runChecks({
      postgres: async () => {
        throw new Error(`fallo conectando a ${secret}`);
      },
    });
    expect(r).toMatchObject({ ok: false, error: "ERROR" });
    expect(JSON.stringify(r)).not.toContain("CLAVE-SECRETA");
    expect(JSON.stringify(r)).not.toContain("host-interno");
  });
});

describe("errorCode", () => {
  it("reconoce los casos habituales", () => {
    expect(errorCode(Object.assign(new Error("x"), { code: "ENOTFOUND" }))).toBe("ENOTFOUND");
    expect(errorCode(new Error("WRONGPASS invalid username-password pair"))).toBe("AUTH");
    expect(errorCode(new Error("NOAUTH Authentication required."))).toBe("AUTH");
    // El código HTTP es más estable que el nombre del error de S3.
    expect(errorCode({ name: "Forbidden", $metadata: { httpStatusCode: 403 } })).toBe("HTTP_403");
    expect(errorCode({ $metadata: { httpStatusCode: 404 } })).toBe("HTTP_404");
    expect(errorCode(new Error("lo que sea"))).toBe("ERROR");
    expect(errorCode(null)).toBe("ERROR");
  });

  it("descarta códigos con caracteres raros", () => {
    expect(errorCode({ code: "contiene espacios y datos: abc" })).toBe("ERROR");
  });
});
