import { z } from "zod";
import { getDb, type Database } from "@/server/db/client";
import { generateApiKey, hashApiKey, isPlausibleApiKey } from "@/server/auth/api-key";
import { DomainError } from "@/server/domain/errors";
import { intersectAccess, type Actor, type Scope } from "@/server/domain/access";
import { accessFromRow, type KeyAccess } from "@/server/domain/mcp-access";
import { PRESET_IDS, presetOf, scopesForPreset, type PresetId, type ToolName } from "@/server/domain/mcp-scopes";
import * as admins from "@/server/repositories/admin-users";
import * as repo from "@/server/repositories/api-keys";
import { listClients } from "@/server/repositories/clients";
import { listAllProjects } from "@/server/repositories/projects";
import { loadScope } from "./access";
import { assertUuid, parseInput } from "./shared";

const keyFieldsInput = z
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
  /** Cuándo se cambió por última vez el secreto (null si nunca se rotó). */
  rotatedAt: Date | null;
  /** Conexión hecha desde otra aplicación (claude.ai web) por OAuth: se renueva sola y no se rota a mano. */
  oauth: boolean;
  /** Cuándo vence el token de acceso actual (solo conexiones OAuth). */
  expiresAt: Date | null;
  /** A qué datos llega la clave, con los nombres ya resueltos (los que ya no existen no se listan). */
  scope: ApiKeyScopeView;
};

type Names = { clients: Map<string, string>; projects: Map<string, { name: string; clientName: string }> };

async function loadNames(db: Database, scope?: Scope): Promise<Names> {
  const [clients, projects] = await Promise.all([listClients(db, scope), listAllProjects(db, scope)]);
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
  rotatedAt: r.rotatedAt,
  oauth: r.oauthClientId !== null,
  expiresAt: r.expiresAt,
  scope: {
    all: r.allAccess,
    clients: r.allAccess ? [] : r.clientIds.flatMap((id) => (names.clients.has(id) ? [{ id, name: names.clients.get(id)! }] : [])),
    projects: r.allAccess ? [] : r.projectIds.flatMap((id) => (names.projects.has(id) ? [{ id, ...names.projects.get(id)! }] : [])),
  },
});

/**
 * Valida los campos de una clave y deja el alcance listo para guardar (ids que existen, sin proyectos redundantes). Con un miembro
 * (`actor`), solo puede elegir lo que él ve; «acceso total» en su clave significa «todo lo que yo vea», también lo que se le comparta después.
 */
export async function resolveKeyFields(raw: unknown, db: Database, actor?: Actor) {
  const input = parseInput(keyFieldsInput, raw);
  const scope = actor && actor.role !== "owner" ? await loadScope(db, actor) : undefined;
  const names = await loadNames(db, scope);

  const all = input.access === "all";
  const clientIds = all ? [] : [...new Set(input.clientIds)];
  const projectIds = all ? [] : [...new Set(input.projectIds)];
  if (clientIds.some((id) => !names.clients.has(id)) || projectIds.some((id) => !names.projects.has(id))) {
    throw new DomainError("INVALID", "Alguno de los clientes o proyectos elegidos ya no existe. Recarga la página e inténtalo de nuevo.");
  }
  // Un proyecto de un cliente ya elegido es redundante: se guarda solo el cliente.
  const listing = await listAllProjects(db, scope);
  const clientOf = new Map(listing.map((p) => [p.id, p.clientId]));
  const keptProjects = projectIds.filter((id) => !clientIds.includes(clientOf.get(id) ?? ""));

  return {
    names,
    fields: { name: input.name, scopes: scopesForPreset(input.preset), allAccess: all, clientIds, projectIds: keptProjects },
  };
}

/** Crea una clave. La clave en claro solo existe en este resultado: en la base se guarda su hash. */
export async function createApiKey(raw: unknown, db: Database = getDb(), actor?: Actor): Promise<{ key: string; view: ApiKeyView }> {
  const { names, fields } = await resolveKeyFields(raw, db, actor);
  const key = generateApiKey();
  // La clave de un miembro queda ligada a él (nunca ve más que él); la del propietario, sin recorte.
  const row = await repo.insertApiKey(db, { ...fields, keyHash: hashApiKey(key), createdBy: actor && actor.role !== "owner" ? actor.id : null });
  return { key, view: toView(row, names) };
}

/**
 * Cambia el nombre, los permisos y el alcance de una clave activa. La clave en sí no cambia; los cambios valen desde la
 * siguiente llamada del agente (la autenticación lee la fila en cada petición).
 */
export async function updateApiKey(id: string, raw: unknown, db: Database = getDb(), actor?: Actor): Promise<ApiKeyView> {
  assertUuid(id, "Clave");
  const { names, fields } = await resolveKeyFields(raw, db, actor);
  const row = await repo.updateKey(db, id, fields);
  if (!row) throw new DomainError("NOT_FOUND", "La clave no existe o ya está revocada: no se puede editar.");
  return toView(row, names);
}

/** Cambia el secreto de una clave activa. La anterior deja de valer al instante; la nueva solo existe en este resultado. */
export async function rotateApiKey(id: string, db: Database = getDb(), now: Date = new Date()): Promise<{ key: string; view: ApiKeyView }> {
  assertUuid(id, "Clave");
  const current = await repo.findKey(db, id);
  if (current?.oauthClientId) throw new DomainError("INVALID", "Esta conexión se renueva sola: no hace falta rotarla. Si quieres cortarla, revócala.");
  const key = generateApiKey();
  const row = await repo.rotateKeyHash(db, id, hashApiKey(key), now);
  if (!row) throw new DomainError("NOT_FOUND", "La clave no existe o ya está revocada: no se puede rotar.");
  return { key, view: toView(row, await loadNames(db)) };
}

/** Borra una clave ya revocada. Una activa hay que revocarla primero. */
export async function deleteApiKey(id: string, db: Database = getDb()): Promise<void> {
  assertUuid(id, "Clave");
  if (await repo.deleteRevoked(db, id)) return;
  const row = await repo.findKey(db, id);
  if (!row) throw new DomainError("NOT_FOUND", "La clave no existe.");
  throw new DomainError("CONFLICT", "La clave sigue activa. Revócala primero y después podrás eliminarla.");
}

/** Un miembro ve y gestiona solo sus claves; el propietario, todas. */
export async function assertKeyAccess(db: Database, actor: Actor, keyId: string): Promise<void> {
  assertUuid(keyId, "Clave");
  const row = await repo.findKey(db, keyId);
  if (!row || (actor.role !== "owner" && row.createdBy !== actor.id)) throw new DomainError("NOT_FOUND", "La clave no existe.");
}

export async function listApiKeys(db: Database = getDb(), actor?: Actor): Promise<ApiKeyView[]> {
  const member = actor && actor.role !== "owner" ? actor : undefined;
  const [rows, names] = await Promise.all([repo.listApiKeys(db, member?.id), loadNames(db, member ? await loadScope(db, member) : undefined)]);
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
  // Las conexiones OAuth tienen token de acceso con vigencia: vencido, se pide uno nuevo con el de refresco.
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return null;
  let access = accessFromRow(row);
  if (row.createdBy) {
    // Una clave de un miembro nunca ve más que él, ni siquiera si lo que ve cambió después de crearla. Sin la persona, sin acceso.
    const creator = await admins.findAdminById(db, row.createdBy);
    if (!creator) return null;
    if (creator.role !== "owner") access = intersectAccess(access, await loadScope(db, { id: creator.id, role: "admin" }));
  }
  await repo.touchKey(db, row.id, now, 60_000).catch(() => undefined);
  return { id: row.id, name: row.name, scopes: row.scopes as ToolName[], access };
}
