import { z } from "zod";
import { getDb, type Database } from "@/server/db/client";
import { generateApiKey, hashApiKey, isPlausibleApiKey } from "@/server/auth/api-key";
import { DomainError } from "@/server/domain/errors";
import { accessFromRow, type KeyAccess } from "@/server/domain/mcp-access";
import { PRESET_IDS, presetOf, scopesForPreset, type PresetId, type ToolName } from "@/server/domain/mcp-scopes";
import * as repo from "@/server/repositories/api-keys";
import { listClients } from "@/server/repositories/clients";
import { listAllProjects } from "@/server/repositories/projects";
import { assertUuid, parseInput } from "./shared";

const createInput = z
  .object({
    name: z.string().trim().min(2, "Ponle un nombre de al menos 2 caracteres.").max(60, "El nombre admite hasta 60 caracteres."),
    preset: z.enum(PRESET_IDS, { error: "Elige los permisos de la clave." }),
    access: z.enum(["all", "selected"], { error: "Elige a qué clientes y proyectos tendrá acceso." }),
    clientIds: z.array(z.uuid("Cliente no válido.")).max(200).default([]),
    projectIds: z.array(z.uuid("Proyecto no válido.")).max(500).default([]),
  })
  .refine((v) => v.access === "all" || v.clientIds.length + v.projectIds.length > 0, {
    message: "Elige al menos un cliente o un proyecto, o marca acceso total.",
    path: ["access"],
  });

export type ApiKeyScopeView = {
  all: boolean;
  clients: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string; clientName: string }>;
};

export type ApiKeyView = {
  id: string;
  name: string;
  preset: PresetId | "custom";
  active: boolean;
  lastUsedAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
  /** A qué datos llega la clave, con los nombres ya resueltos (los que ya no existen no se listan). */
  scope: ApiKeyScopeView;
};

type Names = { clients: Map<string, string>; projects: Map<string, { name: string; clientName: string }> };

async function loadNames(db: Database): Promise<Names> {
  const [clients, projects] = await Promise.all([listClients(db), listAllProjects(db)]);
  return {
    clients: new Map(clients.map((c) => [c.id, c.name])),
    projects: new Map(projects.map((p) => [p.id, { name: p.name, clientName: p.clientName }])),
  };
}

const toView = (r: repo.ApiKeyRow, names: Names): ApiKeyView => ({
  id: r.id,
  name: r.name,
  preset: presetOf(r.scopes),
  active: r.revokedAt === null,
  lastUsedAt: r.lastUsedAt,
  createdAt: r.createdAt,
  revokedAt: r.revokedAt,
  scope: {
    all: r.allAccess,
    clients: r.allAccess ? [] : r.clientIds.flatMap((id) => (names.clients.has(id) ? [{ id, name: names.clients.get(id)! }] : [])),
    projects: r.allAccess ? [] : r.projectIds.flatMap((id) => (names.projects.has(id) ? [{ id, ...names.projects.get(id)! }] : [])),
  },
});

/** Crea una clave. La clave en claro solo existe en este resultado: en la base se guarda su hash. */
export async function createApiKey(raw: unknown, db: Database = getDb()): Promise<{ key: string; view: ApiKeyView }> {
  const input = parseInput(createInput, raw);
  const names = await loadNames(db);

  const all = input.access === "all";
  const clientIds = all ? [] : [...new Set(input.clientIds)];
  // Un proyecto de un cliente ya elegido es redundante: se guarda solo el cliente.
  const projectIds = all ? [] : [...new Set(input.projectIds)];
  if (clientIds.some((id) => !names.clients.has(id)) || projectIds.some((id) => !names.projects.has(id))) {
    throw new DomainError("INVALID", "Alguno de los clientes o proyectos elegidos ya no existe. Recarga la página e inténtalo de nuevo.");
  }
  const listing = await listAllProjects(db);
  const clientOf = new Map(listing.map((p) => [p.id, p.clientId]));
  const keptProjects = projectIds.filter((id) => !clientIds.includes(clientOf.get(id) ?? ""));

  const key = generateApiKey();
  const row = await repo.insertApiKey(db, {
    name: input.name,
    keyHash: hashApiKey(key),
    scopes: scopesForPreset(input.preset),
    allAccess: all,
    clientIds,
    projectIds: keptProjects,
  });
  return { key, view: toView(row, names) };
}

export async function listApiKeys(db: Database = getDb()): Promise<ApiKeyView[]> {
  const [rows, names] = await Promise.all([repo.listApiKeys(db), loadNames(db)]);
  return rows.map((r) => toView(r, names));
}

export async function revokeApiKey(id: string, db: Database = getDb(), now: Date = new Date()): Promise<void> {
  assertUuid(id, "Clave");
  if (!(await repo.revokeKey(db, id, now))) throw new DomainError("NOT_FOUND", "La clave no existe o ya estaba revocada.");
}

export type ApiKeyAuth = { id: string; name: string; scopes: ToolName[]; access: KeyAccess };

/** Identifica la clave de una petición. null si no existe, está revocada o no tiene forma de clave. */
export async function authenticateApiKey(key: string, db: Database = getDb(), now: Date = new Date()): Promise<ApiKeyAuth | null> {
  if (!isPlausibleApiKey(key)) return null;
  const row = await repo.findActiveByHash(db, hashApiKey(key));
  if (!row) return null;
  await repo.touchKey(db, row.id, now, 60_000).catch(() => undefined);
  return { id: row.id, name: row.name, scopes: row.scopes as ToolName[], access: accessFromRow(row) };
}
