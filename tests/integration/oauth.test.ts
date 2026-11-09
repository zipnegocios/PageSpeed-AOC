import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { oauthLimiters } from "@/lib/auth/oauth-limiters";
import { createLimits, handleMcpRequest, type McpDeps } from "@/mcp/handler";
import { createDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import * as s from "@/server/db/schema";
import { listApiKeys, revokeApiKey, updateApiKey, authenticateApiKey } from "@/server/services/api-keys";
import * as clients from "@/server/services/clients";
import * as oauth from "@/server/services/oauth";
import * as projects from "@/server/services/projects";
import * as routes from "@/server/services/routes";

// Las rutas piden la IP del visitante a Next; fuera de una petición de Next se simula.
vi.mock("@/lib/auth/client-ip", () => ({ clientIp: async () => "7.7.7.7" }));

const dbUrl = process.env.TEST_DATABASE_URL;
const APP = "https://app.test";
const MCP_URL = `${APP}/api/mcp`;
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";

describe.skipIf(!dbUrl)("OAuth para conectores de claude.ai", () => {
  const { db, pool } = createDb(dbUrl ?? "", 4);
  const admin = { id: "11111111-1111-4111-8111-111111111111" };
  let deps: McpDeps;

  // Se cargan después de fijar APP_URL: los metadatos salen de ahí.
  let routesMod: {
    resource: (r: Request) => Promise<Response>;
    server: (r: Request) => Promise<Response>;
    register: (r: Request) => Promise<Response>;
    token: (r: Request) => Promise<Response>;
    revoke: (r: Request) => Promise<Response>;
  };

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: dbUrl, SESSION_SECRET: "x".repeat(40), APP_URL: APP, REDIS_URL: process.env.TEST_REDIS_URL ?? "redis://localhost:6379",
      R2_ENDPOINT: "http://127.0.0.1:9", R2_BUCKET: "reportes", R2_ACCESS_KEY_ID: "a", R2_SECRET_ACCESS_KEY: "b", SMTP_HOST: "localhost", EMAIL_FROM: "x@x.test",
    });
    await runMigrations(dbUrl!, "./drizzle");
    const [resource, server, register, token, revoke] = await Promise.all([
      import("@/app/.well-known/oauth-protected-resource/[[...path]]/route"),
      import("@/app/.well-known/oauth-authorization-server/[[...path]]/route"),
      import("@/app/oauth/register/route"),
      import("@/app/oauth/token/route"),
      import("@/app/oauth/revoke/route"),
    ]);
    routesMod = { resource: resource.GET as never, server: server.GET as never, register: register.POST, token: token.POST, revoke: revoke.POST };
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await db.execute(sql`truncate clients, mcp_api_keys, oauth_clients, oauth_codes restart identity cascade`);
    deps = { appOrigin: APP, ip: "9.9.9.9", limits: createLimits() };
    oauthLimiters.register.reset("7.7.7.7");
    oauthLimiters.token.reset("7.7.7.7");
  });

  /** Una petición a la aplicación, como la haría claude.ai: se enruta a los manejadores reales. */
  const appFetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input.toString());
    const req = new Request(url, init);
    if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) return routesMod.resource(req);
    if (url.pathname.startsWith("/.well-known/oauth-authorization-server")) return routesMod.server(req);
    if (url.pathname === "/oauth/register") return routesMod.register(req);
    if (url.pathname === "/oauth/token") return routesMod.token(req);
    if (url.pathname === "/oauth/revoke") return routesMod.revoke(req);
    if (url.pathname === "/api/mcp") return handleMcpRequest(req, deps);
    return new Response("no encontrado", { status: 404 });
  }) as typeof fetch;

  /** Un cliente OAuth en memoria, como el de claude.ai. */
  function memoryProvider() {
    let info: OAuthClientInformationMixed | undefined;
    let tokens: OAuthTokens | undefined;
    let verifier = "";
    let authUrl: URL | undefined;
    const provider: OAuthClientProvider = {
      get redirectUrl() { return CALLBACK; },
      get clientMetadata() { return { client_name: "Claude", redirect_uris: [CALLBACK], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }; },
      state: () => "estado-123",
      clientInformation: () => info,
      saveClientInformation: (i) => { info = i; },
      tokens: () => tokens,
      saveTokens: (t) => { tokens = t; },
      redirectToAuthorization: (u) => { authUrl = u; },
      saveCodeVerifier: (v) => { verifier = v; },
      codeVerifier: () => verifier,
    };
    return { provider, get tokens() { return tokens; }, set tokens(t) { tokens = t; }, get authUrl() { return authUrl; }, get info() { return info; } };
  }

  /** La persona abre la URL de autorización, elige permisos y alcance y autoriza: devuelve la dirección con el código. */
  async function consent(authUrl: URL, fields: Record<string, unknown>) {
    const query = Object.fromEntries(authUrl.searchParams.entries());
    const request = await oauth.validateAuthorizeRequest(query, db);
    return new URL(await oauth.authorize(admin, request, fields, db));
  }

  async function connectFully(fields: Record<string, unknown> = { preset: "read", access: "all" }) {
    const c = memoryProvider();
    expect(await auth(c.provider, { serverUrl: MCP_URL, fetchFn: appFetch })).toBe("REDIRECT");
    const back = await consent(c.authUrl!, fields);
    expect(back.searchParams.get("state")).toBe("estado-123");
    expect(await auth(c.provider, { serverUrl: MCP_URL, authorizationCode: back.searchParams.get("code")!, fetchFn: appFetch })).toBe("AUTHORIZED");
    return c;
  }

  it("el 401 del MCP apunta a los metadatos y los metadatos describen todo el flujo", async () => {
    const r = await handleMcpRequest(new Request(MCP_URL, { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } }), deps);
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toContain(`resource_metadata="${APP}/.well-known/oauth-protected-resource"`);
    const res = await (await appFetch(`${APP}/.well-known/oauth-protected-resource`)).json();
    expect(res).toMatchObject({ resource: MCP_URL, authorization_servers: [APP] });
    const as = await (await appFetch(`${APP}/.well-known/oauth-authorization-server`)).json();
    expect(as).toMatchObject({
      issuer: APP, authorization_endpoint: `${APP}/oauth/authorize`, token_endpoint: `${APP}/oauth/token`, registration_endpoint: `${APP}/oauth/register`,
      code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"],
    });
    expect((await appFetch(`${APP}/.well-known/oauth-protected-resource/api/mcp`)).status).toBe(200);
  });

  it("el cliente OAuth del SDK descubre, se registra, autoriza y llama al MCP con los permisos elegidos", async () => {
    const acme = await clients.createClient({ name: "Acme" }, db);
    const beta = await clients.createClient({ name: "Beta" }, db);
    const pA = await projects.createProject(acme.id, { name: "Tienda", baseUrl: "https://acme.test" }, db);
    await projects.createProject(beta.id, { name: "Blog", baseUrl: "https://beta.test" }, db);
    await routes.addRoute(pA.id, { path: "/" }, db);

    const c = await connectFully({ preset: "read", access: "selected", clientIds: [acme.id] });
    expect(c.info).toMatchObject({ client_id: expect.any(String) });
    expect(c.tokens).toMatchObject({ token_type: "Bearer", expires_in: 3600, access_token: expect.stringMatching(/^pagespeed_/), refresh_token: expect.stringMatching(/^pagespeed_refresh_/) });

    const mcp = new Client({ name: "claude-ai", version: "1.0.0" });
    await mcp.connect(new StreamableHTTPClientTransport(new URL(MCP_URL), { fetch: appFetch, authProvider: c.provider }));
    const tools = (await mcp.listTools()).tools.map((t) => t.name);
    expect(tools).toContain("list_projects");
    expect(tools).not.toContain("run_audit");
    const listed = JSON.parse(((await mcp.callTool({ name: "list_projects", arguments: {} })) as { content: Array<{ text: string }> }).content[0]!.text);
    expect(listed.projects.map((p: { name: string }) => p.name)).toEqual(["Tienda"]);
    await mcp.close();

    // Aparece en la lista de claves como conexión OAuth, con lo que se eligió.
    const [view] = await listApiKeys(db);
    expect(view).toMatchObject({ oauth: true, active: true, preset: "read" });
    expect(view!.name).toContain("Claude");
    expect(view!.scope.clients.map((x) => x.name)).toEqual(["Acme"]);
    expect(view!.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 3_000_000);

    // Editar el alcance se nota en la siguiente llamada, con el mismo token.
    await updateApiKey(view!.id, { name: view!.name, preset: "audit", access: "all" }, db);
    const again = new Client({ name: "claude-ai", version: "1.0.0" });
    await again.connect(new StreamableHTTPClientTransport(new URL(MCP_URL), { fetch: appFetch, authProvider: c.provider }));
    expect((await again.listTools()).tools.map((t) => t.name)).toContain("run_audit");
    await again.close();
  });

  it("refrescar da tokens nuevos, el acceso anterior deja de servir y reutilizar un refresco gastado revoca la conexión", async () => {
    const c = await connectFully();
    const first = c.tokens!;
    expect(await auth(c.provider, { serverUrl: MCP_URL, fetchFn: appFetch })).toBe("AUTHORIZED"); // con refresh_token guardado, renueva
    const second = c.tokens!;
    expect(second.access_token).not.toBe(first.access_token);
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(await authenticateApiKey(first.access_token, db)).toBeNull();
    expect(await authenticateApiKey(second.access_token, db)).not.toBeNull();

    // Alguien presenta el refresco viejo (ya gastado): se corta toda la conexión.
    const stolen = await appFetch(`${APP}/oauth/token`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: first.refresh_token!, client_id: (c.info as { client_id: string }).client_id }),
    });
    expect(stolen.status).toBe(400);
    expect(await stolen.json()).toMatchObject({ error: "invalid_grant" });
    expect(await authenticateApiKey(second.access_token, db)).toBeNull();
    const [row] = await db.select().from(s.mcpApiKeys);
    expect(row!.revokedAt).not.toBeNull();
  });

  it("un token de acceso vencido da 401 y el de refresco vigente lo renueva", async () => {
    const c = await connectFully();
    await db.update(s.mcpApiKeys).set({ expiresAt: new Date(Date.now() - 1000) });
    const r = await appFetch(MCP_URL, { method: "POST", headers: { Authorization: `Bearer ${c.tokens!.access_token}`, "Content-Type": "application/json" }, body: "{}" });
    expect(r.status).toBe(401);
    await db.update(s.mcpApiKeys).set({ refreshExpiresAt: new Date(Date.now() - 1000) });
    const expired = await appFetch(`${APP}/oauth/token`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: c.tokens!.refresh_token!, client_id: (c.info as { client_id: string }).client_id }),
    });
    expect(expired.status).toBe(400);
  });

  it("revocar la conexión (desde el panel o por /oauth/revoke) corta el acceso y el refresco", async () => {
    const a = await connectFully();
    const [view] = await listApiKeys(db);
    await revokeApiKey(view!.id, db);
    expect(await authenticateApiKey(a.tokens!.access_token, db)).toBeNull();
    const refresh = await appFetch(`${APP}/oauth/token`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: a.tokens!.refresh_token!, client_id: (a.info as { client_id: string }).client_id }),
    });
    expect(refresh.status).toBe(400);

    const b = await connectFully();
    const rv = await appFetch(`${APP}/oauth/revoke`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: b.tokens!.access_token }) });
    expect(rv.status).toBe(200);
    expect(await authenticateApiKey(b.tokens!.access_token, db)).toBeNull();
    expect((await appFetch(`${APP}/oauth/revoke`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: "no-existe" }) })).status).toBe(200);
  });

  describe("lo que no debe pasar", () => {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    async function registered() {
      const r = await appFetch(`${APP}/oauth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: "Claude", redirect_uris: [CALLBACK] }) });
      expect(r.status).toBe(201);
      return (await r.json()) as { client_id: string };
    }
    const authorizeQuery = (clientId: string, over: Record<string, string> = {}) => ({
      client_id: clientId, redirect_uri: CALLBACK, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state: "s", ...over,
    });
    const exchange = (clientId: string, code: string, over: Record<string, string> = {}) =>
      appFetch(`${APP}/oauth/token`, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: CALLBACK, code_verifier: verifier, client_id: clientId, ...over }),
      });
    const codeFor = async (clientId: string, fields: Record<string, unknown> = { preset: "read", access: "all" }) =>
      (await consent(new URL(`${APP}/oauth/authorize?${new URLSearchParams(authorizeQuery(clientId))}`), fields)).searchParams.get("code")!;

    it("frena el registro masivo desde una misma conexión", async () => {
      const post = () => appFetch(`${APP}/oauth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ redirect_uris: [CALLBACK] }) });
      for (let i = 0; i < 10; i++) expect((await post()).status).toBe(201);
      expect((await post()).status).toBe(429);
    });

    it("no registra aplicaciones con direcciones de retorno ajenas", async () => {
      for (const uris of [["https://evil.test/cb"], ["https://claude.ai/otra"], []]) {
        const r = await appFetch(`${APP}/oauth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ redirect_uris: uris }) });
        expect(r.status, JSON.stringify(uris)).toBe(400);
      }
      expect(await db.select().from(s.oauthClients)).toHaveLength(0);
    });

    it("la autorización no admite clientes desconocidos, direcciones sin registrar ni falta de PKCE", async () => {
      const { client_id } = await registered();
      for (const bad of [
        authorizeQuery("00000000-0000-4000-8000-000000000000"),
        authorizeQuery(client_id, { redirect_uri: "https://claude.com/api/mcp/auth_callback" }),
        authorizeQuery(client_id, { response_type: "token" }),
        authorizeQuery(client_id, { code_challenge_method: "plain" }),
        authorizeQuery(client_id, { code_challenge: "corto" }),
      ]) await expect(oauth.validateAuthorizeRequest(bad, db)).rejects.toThrow(/no es válida/);
      await expect(oauth.validateAuthorizeRequest(authorizeQuery(client_id), db)).resolves.toMatchObject({ clientName: "Claude" });
    });

    it("al autorizar hay que elegir permisos y alcance (como al crear una clave)", async () => {
      const { client_id } = await registered();
      const request = await oauth.validateAuthorizeRequest(authorizeQuery(client_id), db);
      await expect(oauth.authorize(admin, request, { preset: "read", access: "selected" }, db)).rejects.toThrow(/al menos un cliente o un proyecto/);
      await expect(oauth.authorize(admin, request, { access: "all" }, db)).rejects.toThrow(/permisos/i);
    });

    it("cancelar vuelve con access_denied y sin código", async () => {
      const { client_id } = await registered();
      const request = await oauth.validateAuthorizeRequest(authorizeQuery(client_id), db);
      const back = new URL(oauth.denyRedirect(request));
      expect(back.origin + back.pathname).toBe(CALLBACK);
      expect(back.searchParams.get("error")).toBe("access_denied");
      expect(back.searchParams.get("state")).toBe("s");
      expect(back.searchParams.get("code")).toBeNull();
    });

    it("el código sirve una vez, con su verificador, su dirección y su cliente", async () => {
      const { client_id } = await registered();
      const other = await registered();
      expect((await exchange(client_id, await codeFor(client_id), { code_verifier: randomBytes(32).toString("base64url") })).status).toBe(400); // PKCE malo
      expect((await exchange(client_id, await codeFor(client_id), { redirect_uri: "https://claude.com/api/mcp/auth_callback" })).status).toBe(400);
      expect((await exchange(other.client_id, await codeFor(client_id))).status).toBe(400); // otro cliente
      const ok = await codeFor(client_id);
      expect((await exchange(client_id, ok)).status).toBe(200);
      expect((await exchange(client_id, ok)).status).toBe(400); // segundo canje
      expect((await exchange(client_id, "inventado")).status).toBe(400);
      expect((await exchange("00000000-0000-4000-8000-000000000000", ok)).status).toBe(401);
    });

    it("un código vencido no se canjea", async () => {
      const { client_id } = await registered();
      const code = await codeFor(client_id);
      await db.update(s.oauthCodes).set({ expiresAt: new Date(Date.now() - 1000) });
      expect((await exchange(client_id, code)).status).toBe(400);
      expect(await db.select().from(s.mcpApiKeys)).toHaveLength(0);
    });

    it("el endpoint de token rechaza otros tipos de concesión y responde sin caché", async () => {
      const r = await appFetch(`${APP}/oauth/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "password" }) });
      expect(r.status).toBe(400);
      expect(await r.json()).toMatchObject({ error: "unsupported_grant_type" });
      expect(r.headers.get("cache-control")).toBe("no-store");
    });

    it("una conexión OAuth no se rota a mano: se renueva sola", async () => {
      await connectFully();
      const [view] = await listApiKeys(db);
      const { rotateApiKey } = await import("@/server/services/api-keys");
      await expect(rotateApiKey(view!.id, db)).rejects.toThrow(/se renueva sola/);
      expect(await db.select().from(s.mcpApiKeys).where(eq(s.mcpApiKeys.id, view!.id))).toHaveLength(1);
    });
  });
});
