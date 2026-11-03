import { z } from "zod";
import { getDb, type Database } from "@/server/db/client";
import { generateApiKey, hashApiKey, isPlausibleApiKey } from "@/server/auth/api-key";
import { DomainError } from "@/server/domain/errors";
import { PRESET_IDS, presetOf, scopesForPreset, type PresetId, type ToolName } from "@/server/domain/mcp-scopes";
import * as repo from "@/server/repositories/api-keys";
import { assertUuid, parseInput } from "./shared";

const createInput = z.object({
  name: z.string().trim().min(2, "Ponle un nombre de al menos 2 caracteres.").max(60, "El nombre admite hasta 60 caracteres."),
  preset: z.enum(PRESET_IDS, { error: "Elige los permisos de la clave." }),
});

export type ApiKeyView = {
  id: string;
  name: string;
  preset: PresetId | "custom";
  active: boolean;
  lastUsedAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
};

const toView = (r: repo.ApiKeyRow): ApiKeyView => ({
  id: r.id,
  name: r.name,
  preset: presetOf(r.scopes),
  active: r.revokedAt === null,
  lastUsedAt: r.lastUsedAt,
  createdAt: r.createdAt,
  revokedAt: r.revokedAt,
});

/** Crea una clave. La clave en claro solo existe en este resultado: en la base se guarda su hash. */
export async function createApiKey(raw: unknown, db: Database = getDb()): Promise<{ key: string; view: ApiKeyView }> {
  const input = parseInput(createInput, raw);
  const key = generateApiKey();
  const row = await repo.insertApiKey(db, { name: input.name, keyHash: hashApiKey(key), scopes: scopesForPreset(input.preset) });
  return { key, view: toView(row) };
}

export async function listApiKeys(db: Database = getDb()): Promise<ApiKeyView[]> {
  return (await repo.listApiKeys(db)).map(toView);
}

export async function revokeApiKey(id: string, db: Database = getDb(), now: Date = new Date()): Promise<void> {
  assertUuid(id, "Clave");
  if (!(await repo.revokeKey(db, id, now))) throw new DomainError("NOT_FOUND", "La clave no existe o ya estaba revocada.");
}

export type ApiKeyAuth = { id: string; name: string; scopes: ToolName[] };

/** Identifica la clave de una petición. null si no existe, está revocada o no tiene forma de clave. */
export async function authenticateApiKey(key: string, db: Database = getDb(), now: Date = new Date()): Promise<ApiKeyAuth | null> {
  if (!isPlausibleApiKey(key)) return null;
  const row = await repo.findActiveByHash(db, hashApiKey(key));
  if (!row) return null;
  await repo.touchKey(db, row.id, now, 60_000).catch(() => undefined);
  return { id: row.id, name: row.name, scopes: row.scopes as ToolName[] };
}
