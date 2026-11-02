import { describe, expect, it } from "vitest";
import { parseEnv } from "@/server/config/env";

const base = {
  SESSION_SECRET: "x".repeat(32),
  DATABASE_URL: "postgres://aoc:aoc@localhost:5432/aoc",
  REDIS_URL: "redis://localhost:6379",
  R2_ENDPOINT: "http://localhost:9000",
  R2_BUCKET: "aoc",
  R2_ACCESS_KEY_ID: "a",
  R2_SECRET_ACCESS_KEY: "b",
  SMTP_HOST: "localhost",
  EMAIL_FROM: "AOC <no-reply@localhost>",
};

describe("parseEnv", () => {
  it("applies defaults for the audit worker", () => {
    const env = parseEnv(base);
    expect(env.AUDIT_ATTEMPTS).toBe(3);
    expect(env.AUDIT_COOLDOWN_MS).toBe(12_000);
    expect(env.SMTP_PORT).toBe(587);
  });

  it("rejects a short session secret", () => {
    expect(() => parseEnv({ ...base, SESSION_SECRET: "short" })).toThrow(/SESSION_SECRET/);
  });

  it("rejects an encryption key that is not 32 bytes", () => {
    expect(() => parseEnv({ ...base, AUTH_ENCRYPTION_KEY: "AAAA" })).toThrow(/AUTH_ENCRYPTION_KEY/);
  });
});
