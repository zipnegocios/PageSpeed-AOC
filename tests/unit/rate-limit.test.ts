import { describe, expect, it } from "vitest";
import { AttemptLimiter } from "@/server/auth/rate-limit";

describe("limitador de intentos", () => {
  it("bloquea al llegar al máximo y se libera al pasar la ventana", () => {
    let now = 1_000_000;
    const limiter = new AttemptLimiter({ max: 3, windowMs: 60_000, now: () => now });
    for (let i = 0; i < 2; i++) limiter.recordFailure("k");
    expect(limiter.isBlocked("k")).toBe(false);
    limiter.recordFailure("k");
    expect(limiter.isBlocked("k")).toBe(true);
    expect(limiter.retryAfterSeconds("k")).toBe(60);
    now += 59_000;
    expect(limiter.isBlocked("k")).toBe(true);
    expect(limiter.retryAfterSeconds("k")).toBe(1);
    now += 2_000;
    expect(limiter.isBlocked("k")).toBe(false);
    expect(limiter.retryAfterSeconds("k")).toBe(0);
  });

  it("cuenta cada clave por separado y reset limpia los fallos", () => {
    const limiter = new AttemptLimiter({ max: 1, windowMs: 1000, now: () => 5 });
    limiter.recordFailure("a");
    expect(limiter.isBlocked("a")).toBe(true);
    expect(limiter.isBlocked("b")).toBe(false);
    limiter.reset("a");
    expect(limiter.isBlocked("a")).toBe(false);
  });
});
