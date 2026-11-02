import { z } from "zod";
import { getDb, type Database } from "@/server/db/client";
import { projects, routes } from "@/server/db/schema";
import { DomainError } from "@/server/domain/errors";
import { normalizePath, routeUrl } from "@/server/domain/route-path";
import { parseSitemap } from "@/server/domain/sitemap";
import { fetchGuarded, isHostAllowed, parseHttpUrl } from "@/server/domain/url-guard";
import { findProject } from "@/server/repositories/projects";
import { listRoutes } from "@/server/repositories/routes";
import { eq } from "drizzle-orm";
import { assertUuid, parseInput } from "./shared";

const MAX_CANDIDATES = 500;
const MAX_CHILD_SITEMAPS = 5;

export type SitemapCandidate = { path: string; url: string };
export type DiscoveryResult = {
  sitemapUrl: string;
  candidates: SitemapCandidate[];
  alreadyAdded: number;
  otherHosts: number;
  truncated: boolean;
};

/** Solo para pruebas: permite sitemaps servidos desde direcciones privadas. */
export type DiscoveryOptions = { allowPrivate?: boolean };

export async function discoverRoutes(
  projectId: string,
  db: Database = getDb(),
  options: DiscoveryOptions = {},
): Promise<DiscoveryResult> {
  assertUuid(projectId, "Proyecto");
  const project = await findProject(db, projectId);
  if (!project) throw new DomainError("NOT_FOUND", "Proyecto no encontrado.");

  const sitemapUrl = project.sitemapUrl ?? new URL("/sitemap.xml", project.baseUrl).toString();
  const fetchXml = async (url: string) => {
    const res = await fetchGuarded(url, {
      allowedHosts: project.allowedHosts,
      accept: "application/xml,text/xml,*/*;q=0.1",
      allowPrivate: options.allowPrivate,
    });
    if (res.status === 404) throw new DomainError("UPSTREAM", `No se encontró el sitemap en ${url}.`);
    if (res.status >= 400) throw new DomainError("UPSTREAM", `El sitemap respondió con el código ${res.status}.`);
    return parseSitemap(res.text);
  };

  const root = await fetchXml(sitemapUrl);
  if (root.kind === "unknown") {
    throw new DomainError("UPSTREAM", "La respuesta no parece un sitemap XML válido.");
  }

  const locs: string[] = [];
  if (root.kind === "urlset") locs.push(...root.locs);
  else {
    for (const child of root.locs.slice(0, MAX_CHILD_SITEMAPS)) {
      try {
        const parsed = await fetchXml(child);
        if (parsed.kind === "urlset") locs.push(...parsed.locs);
      } catch (err) {
        // Un sitemap hijo caído o de otro host no invalida los demás.
        if (!(err instanceof DomainError)) throw err;
      }
    }
  }

  const existing = new Set((await listRoutes(db, projectId)).map((r) => r.path));
  const seen = new Set<string>();
  const candidates: SitemapCandidate[] = [];
  let alreadyAdded = 0;
  let otherHosts = 0;
  let truncated = false;

  for (const loc of locs) {
    let path: string;
    try {
      const url = parseHttpUrl(loc);
      if (!isHostAllowed(url.hostname, project.allowedHosts)) {
        otherHosts++;
        continue;
      }
      path = normalizePath(url.pathname);
    } catch {
      continue;
    }
    if (seen.has(path)) continue;
    seen.add(path);
    if (existing.has(path)) {
      alreadyAdded++;
      continue;
    }
    if (candidates.length >= MAX_CANDIDATES) {
      truncated = true;
      break;
    }
    candidates.push({ path, url: routeUrl(project.baseUrl, path) });
  }

  await db.update(projects).set({ lastSitemapScanAt: new Date() }).where(eq(projects.id, projectId));
  return { sitemapUrl, candidates, alreadyAdded, otherHosts, truncated };
}

const importInput = z.array(z.string().min(1).max(500)).min(1, { error: "Selecciona al menos una ruta." }).max(MAX_CANDIDATES);

/** Activa para monitoreo las rutas elegidas. Ignora las que ya existen. */
export async function importRoutes(projectId: string, rawPaths: unknown, db: Database = getDb()) {
  assertUuid(projectId, "Proyecto");
  const project = await findProject(db, projectId);
  if (!project) throw new DomainError("NOT_FOUND", "Proyecto no encontrado.");
  const paths = [...new Set(parseInput(importInput, rawPaths).map(normalizePath))];
  const inserted = await db
    .insert(routes)
    .values(
      paths.map((path) => ({
        projectId,
        path,
        url: routeUrl(project.baseUrl, path),
        source: "sitemap" as const,
        monitored: true,
      })),
    )
    .onConflictDoNothing({ target: [routes.projectId, routes.path] })
    .returning({ id: routes.id });
  return { added: inserted.length, skipped: paths.length - inserted.length };
}
