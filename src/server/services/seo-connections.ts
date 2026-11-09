import { getDb, type Database } from "@/server/db/client";
import { decryptJson, encryptJson } from "@/server/crypto/secret-box";
import { DomainError } from "@/server/domain/errors";
import {
  explainFailure,
  gscPermissionText,
  normalizeCloudflareToken,
  normalizeExternalId,
  parseKind,
  SEO_KINDS,
  type SeoKind,
} from "@/server/domain/seo-connections";
import { listAllProjects, findProject, type ProjectListing } from "@/server/repositories/projects";
import * as repo from "@/server/repositories/seo-integrations";
import { deleteSetting, getSetting, setSetting } from "@/server/repositories/settings";
import { buildAiCrawlerQuery, cfGraphql, verifyToken } from "@/server/seo/cloudflare";
import { GA4_SCOPE, runReport } from "@/server/seo/ga4";
import { getAccessToken, parseServiceAccountKey, type ServiceAccountKey } from "@/server/seo/google-auth";
import { GSC_SCOPE, listSites } from "@/server/seo/gsc";
import { SpikeHttpError, type FetchLike } from "@/server/seo/http";
import { requireEncryptionKey } from "./project-auth";
import { assertUuid } from "./shared";

/** Dónde se guarda la cuenta de servicio de Google: una sola para todo el panel, cifrada. */
const GOOGLE_ACCOUNT_SETTING = "seo.google_service_account";

type Deps = {
  /** Solo pruebas: clave de cifrado distinta de AUTH_ENCRYPTION_KEY. */
  key?: string;
  /** Solo pruebas: sustituye a `fetch`. */
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
};

const keyOf = (deps: Deps) => deps.key ?? process.env.AUTH_ENCRYPTION_KEY;

// ----------------------------------------------------------- cuenta de Google

export type GoogleAccountSummary = { configured: false } | { configured: true; email: string; unreadable?: boolean };

export async function getGoogleAccount(db: Database = getDb(), deps: Deps = {}): Promise<GoogleAccountSummary> {
  const stored = await getSetting<{ enc?: string; email?: string }>(db, GOOGLE_ACCOUNT_SETTING);
  if (!stored?.enc || !stored.email) return { configured: false };
  try {
    decryptJson(Buffer.from(stored.enc, "base64"), keyOf(deps));
    return { configured: true, email: stored.email };
  } catch {
    return { configured: true, email: stored.email, unreadable: true };
  }
}

/**
 * Guarda la llave JSON de la cuenta de servicio de Google (cifrada). Antes comprueba que Google la acepta, así que
 * una llave mal pegada o desactivada se rechaza aquí y no más tarde, al probar cada proyecto.
 */
export async function saveGoogleAccount(raw: string, db: Database = getDb(), deps: Deps = {}): Promise<{ email: string }> {
  const encryptionKey = requireEncryptionKey(deps.key);
  let account: ServiceAccountKey;
  try {
    account = parseServiceAccountKey(raw);
  } catch (err) {
    throw new DomainError("INVALID", err instanceof Error ? err.message : "La llave no es válida.");
  }
  try {
    await getAccessToken(account, [GSC_SCOPE], { fetchImpl: deps.fetchImpl, sleep: deps.sleep, fresh: true, retries: 0 });
  } catch (err) {
    const rejected = err instanceof SpikeHttpError && (err.code === "BAD_REQUEST" || err.code === "AUTH" || err.code === "FORBIDDEN");
    throw new DomainError(
      "INVALID",
      rejected
        ? "Google rechazó la llave. Puede que la cuenta de servicio o la llave se hayan eliminado o desactivado: crea una llave nueva y pégala completa."
        : "No se pudo contactar con Google para comprobar la llave. Inténtalo de nuevo en unos minutos.",
    );
  }
  const enc = encryptJson(account, encryptionKey).toString("base64");
  await setSetting(db, GOOGLE_ACCOUNT_SETTING, { enc, email: account.client_email });
  return { email: account.client_email };
}

export async function clearGoogleAccount(db: Database = getDb()): Promise<void> {
  await deleteSetting(db, GOOGLE_ACCOUNT_SETTING);
}

async function loadGoogleAccount(db: Database, deps: Deps): Promise<ServiceAccountKey | null> {
  const stored = await getSetting<{ enc?: string }>(db, GOOGLE_ACCOUNT_SETTING);
  if (!stored?.enc) return null;
  try {
    return decryptJson<ServiceAccountKey>(Buffer.from(stored.enc, "base64"), keyOf(deps));
  } catch {
    throw new DomainError("INVALID", "La cuenta de servicio guardada no se puede leer con la clave actual (AUTH_ENCRYPTION_KEY). Vuelve a pegarla en SEO.");
  }
}

// ------------------------------------------------------ conexiones por proyecto

export type SeoConnection = {
  kind: SeoKind;
  externalId: string;
  status: "pending" | "ok" | "error";
  detail: string | null;
  lastCheckedAt: Date | null;
  lastOkAt: Date | null;
  /** Cloudflare guarda un token cifrado; aquí solo se dice si existe. */
  hasCredential: boolean;
};

const toConnection = (row: repo.SeoIntegration): SeoConnection => ({
  kind: row.kind,
  externalId: row.externalId,
  status: row.status,
  detail: row.detail,
  lastCheckedAt: row.lastCheckedAt,
  lastOkAt: row.lastOkAt,
  hasCredential: row.credentialEnc !== null,
});

/** Las tres conexiones posibles de un proyecto; null donde todavía no hay nada guardado. */
export async function getConnections(projectId: string, db: Database = getDb()): Promise<Record<SeoKind, SeoConnection | null>> {
  assertUuid(projectId, "Proyecto");
  const rows = await repo.listForProject(db, projectId);
  const out: Record<SeoKind, SeoConnection | null> = { gsc: null, ga4: null, cloudflare: null };
  for (const row of rows) out[row.kind] = toConnection(row);
  return out;
}

export async function saveConnection(
  projectId: string,
  kindRaw: string,
  input: { externalId: string; token?: string },
  db: Database = getDb(),
  deps: Deps = {},
): Promise<SeoConnection> {
  assertUuid(projectId, "Proyecto");
  const kind = parseKind(kindRaw);
  if (!(await findProject(db, projectId))) throw new DomainError("NOT_FOUND", "Proyecto no encontrado.");
  const externalId = normalizeExternalId(kind, input.externalId);

  let credentialEnc: Buffer | undefined;
  if (kind === "cloudflare") {
    const token = input.token?.trim();
    if (token) credentialEnc = encryptJson({ token: normalizeCloudflareToken(token) }, requireEncryptionKey(deps.key));
    else if (!(await repo.findOne(db, projectId, kind))?.credentialEnc) throw new DomainError("INVALID", "Pega el token de Cloudflare.");
  }
  return toConnection(await repo.upsert(db, projectId, kind, { externalId, credentialEnc }));
}

export async function removeConnection(projectId: string, kindRaw: string, db: Database = getDb()): Promise<void> {
  assertUuid(projectId, "Proyecto");
  if ((await repo.remove(db, projectId, parseKind(kindRaw))) === 0) throw new DomainError("NOT_FOUND", "Esa conexión no existe.");
}

export type TestResult = { ok: boolean; detail: string };

/** Prueba la conexión contra Google o Cloudflare, anota el resultado y lo devuelve con un mensaje que dice qué hacer. */
export async function testConnection(projectId: string, kindRaw: string, db: Database = getDb(), deps: Deps = {}): Promise<TestResult> {
  assertUuid(projectId, "Proyecto");
  const kind = parseKind(kindRaw);
  const row = await repo.findOne(db, projectId, kind);
  if (!row) throw new DomainError("NOT_FOUND", "Primero guarda esta conexión.");

  let result: TestResult;
  let email: string | null = null;
  try {
    if (kind === "cloudflare") {
      result = await checkCloudflare(row, deps);
    } else {
      const account = await loadGoogleAccount(db, deps);
      email = account?.client_email ?? null;
      result = account ? await checkGoogle(kind, row.externalId, account, deps) : { ok: false, detail: "Falta la cuenta de servicio de Google. Configúrala en SEO → Cuenta de Google." };
    }
  } catch (err) {
    if (err instanceof DomainError) result = { ok: false, detail: err.message };
    else if (err instanceof SpikeHttpError) result = { ok: false, detail: explainFailure(kind, err.code, { email }) };
    else {
      console.error("[seo] prueba de conexión", err instanceof Error ? err.name : "error");
      result = { ok: false, detail: "No se pudo completar la prueba. Inténtalo de nuevo." };
    }
  }
  await repo.recordCheck(db, row.id, { ...result, at: (deps.now ?? (() => new Date()))() });
  return result;
}

async function checkGoogle(kind: "gsc" | "ga4", externalId: string, account: ServiceAccountKey, deps: Deps): Promise<TestResult> {
  const http = { fetchImpl: deps.fetchImpl, sleep: deps.sleep };
  let token: string;
  try {
    token = await getAccessToken(account, [kind === "gsc" ? GSC_SCOPE : GA4_SCOPE], http);
  } catch {
    return { ok: false, detail: "Google no aceptó la cuenta de servicio guardada. Vuelve a pegar la llave en SEO → Cuenta de Google." };
  }

  if (kind === "gsc") {
    const sites = await listSites({ token, ...http });
    const mine = sites.find((s) => s.siteUrl === externalId);
    if (mine) return { ok: true, detail: `Acceso correcto como ${gscPermissionText(mine.permissionLevel)}.` };
    const visible = sites.slice(0, 5).map((s) => s.siteUrl);
    return {
      ok: false,
      detail:
        `La cuenta de servicio no ve esa propiedad. En Search Console, Configuración → Usuarios y permisos, agrega ${account.client_email}.` +
        (visible.length ? ` Hoy ve: ${visible.join(", ")}${sites.length > visible.length ? "…" : ""}.` : " Hoy no ve ninguna propiedad."),
    };
  }

  const res = await runReport({ token, ...http }, externalId, { startDate: "7daysAgo", endDate: "yesterday", dimensions: ["date"], metrics: ["sessions"], pageSize: 1 });
  return { ok: true, detail: res.rowCount ? "Acceso correcto: la propiedad responde con datos." : "Acceso correcto, aunque la propiedad no tiene datos en la última semana." };
}

async function checkCloudflare(row: repo.SeoIntegration, deps: Deps): Promise<TestResult> {
  if (!row.credentialEnc) return { ok: false, detail: "Falta el token de Cloudflare." };
  let token: string;
  try {
    token = decryptJson<{ token: string }>(row.credentialEnc, keyOf(deps)).token;
  } catch {
    return { ok: false, detail: "El token guardado no se puede leer con la clave actual (AUTH_ENCRYPTION_KEY). Vuelve a pegarlo." };
  }
  const http = { token, fetchImpl: deps.fetchImpl, sleep: deps.sleep };
  const status = await verifyToken(http);
  if (status.status !== "active") return { ok: false, detail: `El token de Cloudflare no está activo (estado: ${status.status}).` };
  const to = (deps.now ?? (() => new Date()))();
  const iso = (d: Date) => `${d.toISOString().slice(0, 19)}Z`;
  await cfGraphql(http, buildAiCrawlerQuery({ zone: row.externalId, from: iso(new Date(to.getTime() - 3_600_000)), to: iso(to), limit: 1 }), "cf-check");
  return { ok: true, detail: "Token activo y la zona responde." };
}

// --------------------------------------------------------------- resumen general

export type SeoOverviewRow = ProjectListing & { connections: Record<SeoKind, "pending" | "ok" | "error" | null> };

/** Todos los proyectos con el estado de cada conexión, para la pantalla general de SEO. */
export async function getSeoOverview(db: Database = getDb()): Promise<SeoOverviewRow[]> {
  const [projects, integrations] = await Promise.all([listAllProjects(db), repo.listAll(db)]);
  const byProject = new Map<string, Record<SeoKind, "pending" | "ok" | "error" | null>>();
  for (const i of integrations) {
    const entry = byProject.get(i.projectId) ?? { gsc: null, ga4: null, cloudflare: null };
    entry[i.kind] = i.status;
    byProject.set(i.projectId, entry);
  }
  return projects.map((p) => ({ ...p, connections: byProject.get(p.id) ?? Object.fromEntries(SEO_KINDS.map((k) => [k, null])) as SeoOverviewRow["connections"] }));
}
