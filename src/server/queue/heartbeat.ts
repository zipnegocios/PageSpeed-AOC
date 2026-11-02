import type { Redis } from "ioredis";

export const HEARTBEAT_KEY = "aoc:worker:heartbeat";
/** El latido expira solo: si el worker se detiene, en 30 s deja de verse en línea. */
export const HEARTBEAT_TTL_SECONDS = 30;

export type Heartbeat = { at: number; pid: number; chrome: boolean };

export async function writeHeartbeat(redis: Redis, info: { chrome: boolean }): Promise<void> {
  const beat: Heartbeat = { at: Date.now(), pid: process.pid, chrome: info.chrome };
  await redis.set(HEARTBEAT_KEY, JSON.stringify(beat), "EX", HEARTBEAT_TTL_SECONDS);
}

export async function clearHeartbeat(redis: Redis): Promise<void> {
  await redis.del(HEARTBEAT_KEY);
}

/** Último latido del worker, o null si no está en línea. */
export async function readHeartbeat(redis: Redis): Promise<Heartbeat | null> {
  const raw = await redis.get(HEARTBEAT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Heartbeat;
  } catch {
    return null;
  }
}
