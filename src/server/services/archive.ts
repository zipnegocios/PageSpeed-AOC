import type { Queue } from "bullmq";
import { getDb, type Database } from "@/server/db/client";
import { DomainError } from "@/server/domain/errors";
import * as repo from "@/server/repositories/archive";
import { getR2, type R2Store } from "@/server/storage/r2";
import { applyScheduler } from "./projects";
import { assertUuid } from "./shared";

export type { ArchivedClient, ArchivedProject } from "@/server/repositories/archive";

type Deps = { r2?: Pick<R2Store, "listObjects" | "deleteObjects">; maintenance?: Queue; lighthouse?: Queue };

/** `by`: solo lo que esa persona puede restaurar o borrar (el propietario, todo; un miembro, sus clientes). */
export function listArchivedClients(db: Database = getDb(), by?: repo.ManageBy) {
  return repo.listArchivedClients(db, by);
}

export function listArchivedProjects(db: Database = getDb(), by?: repo.ManageBy) {
  return repo.listArchivedProjects(db, by);
}

/** El nombre escrito debe ser idéntico al guardado (solo se ignoran espacios en los bordes). */
function assertConfirmed(typed: string | undefined, name: string, what: string): void {
  if ((typed ?? "").trim() !== name) {
    throw new DomainError("INVALID", `Para eliminar ${what} escribe su nombre exacto: «${name}».`);
  }
}

/**
 * Borra del almacenamiento los informes indicados y todo lo que cuelga de los prefijos. Si falla, no se toca la base de
 * datos. Las claves exactas (guardadas en cada auditoría) cubren las carpetas de identificadores anteriores.
 */
async function purge(prefixes: string[], keys: string[], r2: Deps["r2"]): Promise<number> {
  try {
    const store = r2 ?? getR2();
    const all = new Set(keys);
    for (const prefix of prefixes) for (const o of await store.listObjects(prefix)) all.add(o.key);
    if (all.size > 0) await store.deleteObjects([...all]);
    return all.size;
  } catch {
    throw new DomainError("UPSTREAM", "No se pudieron borrar los informes guardados. No se eliminó nada; revisa el almacenamiento (R2) e inténtalo de nuevo.");
  }
}

export async function restoreClient(id: string, db: Database = getDb()): Promise<void> {
  assertUuid(id, "Cliente");
  if (!(await repo.restoreClientRow(db, id))) throw new DomainError("NOT_FOUND", "Cliente archivado no encontrado.");
}

/** Devuelve el proyecto al panel. Si su cliente sigue archivado, hay que restaurar primero al cliente. */
export async function restoreProject(id: string, db: Database = getDb(), deps: Deps = {}): Promise<void> {
  assertUuid(id, "Proyecto");
  const found = await repo.findArchivedProject(db, id);
  if (!found) throw new DomainError("NOT_FOUND", "Proyecto archivado no encontrado.");
  if (found.clientDeletedAt) throw new DomainError("CONFLICT", "El cliente de este proyecto está archivado. Restaura primero al cliente.");
  const restored = await repo.restoreProjectRow(db, id);
  if (!restored) throw new DomainError("NOT_FOUND", "Proyecto archivado no encontrado.");
  // Un proyecto en producción vuelve a quedar agendado.
  await applyScheduler(restored, db, deps);
}

/** Eliminación definitiva: solo de lo ya archivado, con el nombre escrito y llevándose sus informes de R2. */
export async function deleteProject(id: string, confirmName: string | undefined, db: Database = getDb(), deps: Deps = {}) {
  assertUuid(id, "Proyecto");
  const found = await repo.findArchivedProject(db, id);
  if (!found) throw new DomainError("NOT_FOUND", "Proyecto archivado no encontrado. Solo se pueden eliminar proyectos archivados.");
  assertConfirmed(confirmName, found.project.name, "el proyecto");
  // Carpeta actual y las de identificadores anteriores (del proyecto y del cliente: quedan reservados, no se reutilizan).
  const clientSlugs = [found.clientSlug, ...found.clientSlugAliases];
  const projectSlugs = [found.project.slug, ...found.project.slugAliases];
  const prefixes = clientSlugs.flatMap((c) => projectSlugs.map((p) => `${c}/${p}/`));
  const files = await purge(prefixes, await repo.listProjectR2Keys(db, id), deps.r2);
  await repo.deleteProjectRow(db, id);
  return { files };
}

export async function deleteClient(id: string, confirmName: string | undefined, db: Database = getDb(), deps: Deps = {}) {
  assertUuid(id, "Cliente");
  const client = await repo.findArchivedClient(db, id);
  if (!client) throw new DomainError("NOT_FOUND", "Cliente archivado no encontrado. Solo se pueden eliminar clientes archivados.");
  assertConfirmed(confirmName, client.name, "el cliente");
  const prefixes = [client.slug, ...client.slugAliases].map((c) => `${c}/`);
  const files = await purge(prefixes, await repo.listClientR2Keys(db, id), deps.r2);
  await repo.deleteClientRow(db, id);
  return { files };
}
