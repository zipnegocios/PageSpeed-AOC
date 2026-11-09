import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Esquema de PageSpeed. Postgres guarda solo el índice liviano de auditorías,
 * metadatos y configuración; el JSON completo de cada auditoría vive en R2.
 * Convenciones: PK uuid, timestamptz en UTC, soft-delete solo en clients y projects.
 */

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// ---------------------------------------------------------------- enums
export const clientStatus = pgEnum("client_status", ["active", "suspended"]);
export const projectPhase = pgEnum("project_phase", ["development", "production"]);
export const auditFrequency = pgEnum("audit_frequency", ["weekly", "daily"]);
export const authStrategy = pgEnum("auth_strategy", ["none", "cookie", "script"]);
export const routeSource = pgEnum("route_source", ["sitemap", "manual", "adhoc"]);
export const alertMetric = pgEnum("alert_metric", [
  "performance",
  "seo",
  "accessibility",
  "best_practices",
]);
export const auditProfile = pgEnum("audit_profile", ["mobile", "desktop"]);
export const auditTrigger = pgEnum("audit_trigger", ["scheduled", "manual", "mcp"]);
export const auditStatus = pgEnum("audit_status", ["queued", "running", "succeeded", "failed"]);
export const alertKind = pgEnum("alert_kind", ["threshold", "audit_failure"]);
export const seoIntegrationKind = pgEnum("seo_integration_kind", ["gsc", "ga4", "cloudflare"]);
export const seoIntegrationStatus = pgEnum("seo_integration_status", ["pending", "ok", "error"]);
export const alertStateStatus = pgEnum("alert_state_status", ["open", "resolved", "suppressed"]);
export const notificationType = pgEnum("notification_type", [
  "initial",
  "reminder",
  "failure",
  "report",
]);
export const notificationStatus = pgEnum("notification_status", ["sent", "failed"]);

// -------------------------------------------------------------- clients
export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // Se puede cambiar (el anterior pasa a `slugAliases`). Los informes ya guardados conservan su carpeta de R2
  // porque cada auditoría guarda su clave completa.
  slug: text("slug").notNull().unique(),
  // Identificadores anteriores: siguen resolviendo al cliente (enlaces viejos) y quedan reservados.
  slugAliases: text("slug_aliases")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  // Para generar el link wa.me con el mensaje prellenado.
  contactPhone: text("contact_phone"),
  status: clientStatus("status").notNull().default("active"),
  // Heredado: el link con token ya no da acceso (solo redirige al portal con PIN). Se conserva para esos enlaces viejos.
  magicToken: text("magic_token").notNull().unique(),
  magicTokenRotatedAt: timestamp("magic_token_rotated_at", { withTimezone: true }),
  // PIN de 6 dígitos del portal: solo se guarda su huella (HMAC). `pinVersion` sube con cada PIN nuevo y
  // con ello se cierran las sesiones abiertas del cliente.
  pinHash: text("pin_hash"),
  pinVersion: integer("pin_version").notNull().default(0),
  // El último PIN, cifrado (AES-256-GCM con AUTH_ENCRYPTION_KEY) para poder mostrarlo en el panel. La clave no está
  // en la base ni en los respaldos. null si se generó sin clave disponible o antes de existir esta columna.
  pinEnc: bytea("pin_enc"),
  pinUpdatedAt: timestamp("pin_updated_at", { withTimezone: true }),
  // Último envío de PIN por correo pedido por el cliente: limita la frecuencia.
  pinRequestedAt: timestamp("pin_requested_at", { withTimezone: true }),
  notes: text("notes"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  ...timestamps,
});

// ------------------------------------------------------------- projects
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    // Único dentro del cliente. Se puede cambiar (el anterior pasa a `slugAliases`).
    slug: text("slug").notNull(),
    slugAliases: text("slug_aliases")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    baseUrl: text("base_url").notNull(),
    // Lista de hosts permitidos (anti-SSRF). Por defecto, el host de base_url.
    allowedHosts: text("allowed_hosts")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    phase: projectPhase("phase").notNull().default("development"),
    phaseChangedAt: timestamp("phase_changed_at", { withTimezone: true }).notNull().defaultNow(),
    // Relevante solo en producción; daily = tier prioritario.
    auditFrequency: auditFrequency("audit_frequency").notNull().default("weekly"),
    sitemapUrl: text("sitemap_url"),
    lastSitemapScanAt: timestamp("last_sitemap_scan_at", { withTimezone: true }),
    authStrategy: authStrategy("auth_strategy").notNull().default("none"),
    // AES-256-GCM con AUTH_ENCRYPTION_KEY. Usuario de prueba dedicado, nunca el admin real.
    authConfigEnc: bytea("auth_config_enc"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [unique("projects_client_slug_unique").on(t.clientId, t.slug)],
);

// --------------------------------------------------------------- routes
export const routes = pgTable(
  "routes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Normalizado: empieza con "/", sin fragmento.
    path: text("path").notNull(),
    url: text("url").notNull(),
    label: text("label"),
    source: routeSource("source").notNull().default("manual"),
    // true = entra a las auditorías programadas de producción.
    // false = candidata del sitemap o página ad-hoc auditada bajo demanda.
    monitored: boolean("monitored").notNull().default(false),
    requiresAuth: boolean("requires_auth").notNull().default(false),
    ...timestamps,
  },
  (t) => [unique("routes_project_path_unique").on(t.projectId, t.path)],
);

// ----------------------------------------------------- alert_thresholds
export const alertThresholds = pgTable(
  "alert_thresholds",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    metric: alertMetric("metric").notNull(),
    minScore: smallint("min_score").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    // Corridas consecutivas bajo el umbral antes de alertar (D2). MVP: 1.
    confirmRuns: smallint("confirm_runs").notNull().default(1),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.metric] }),
    check("alert_thresholds_min_score_range", sql`${t.minScore} between 0 and 100`),
    check("alert_thresholds_confirm_runs_min", sql`${t.confirmRuns} >= 1`),
  ],
);

// ----------------------------------------------------------- audit_logs
export const auditLogs = pgTable(
  "audit_logs",
  {
    // = jobId de BullMQ. Se crea al encolar.
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    routeId: uuid("route_id")
      .notNull()
      .references(() => routes.id, { onDelete: "cascade" }),
    profile: auditProfile("profile").notNull(),
    trigger: auditTrigger("trigger").notNull(),
    requestedBy: text("requested_by"),
    // Snapshot de la fase del proyecto al ejecutar.
    phaseAtRun: projectPhase("phase_at_run").notNull(),
    status: auditStatus("status").notNull().default("queued"),
    attempts: smallint("attempts").notNull().default(0),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    scorePerformance: smallint("score_performance"),
    scoreSeo: smallint("score_seo"),
    scoreAccessibility: smallint("score_accessibility"),
    scoreBestPractices: smallint("score_best_practices"),
    lcpMs: integer("lcp_ms"),
    cls: numeric("cls", { precision: 7, scale: 4 }),
    tbtMs: integer("tbt_ms"),
    fcpMs: integer("fcp_ms"),
    ttfbMs: integer("ttfb_ms"),
    // Lighthouse en modo navigation no mide INP; queda nullable (decisión D1).
    inpMs: integer("inp_ms"),
    // "Navegación con agentes" (Lighthouse 13): superadas / totales. No es una nota de 0 a 100 y no genera alertas.
    agenticPassed: smallint("agentic_passed"),
    agenticTotal: smallint("agentic_total"),
    lighthouseVersion: text("lighthouse_version"),
    finalUrl: text("final_url"),
    httpStatus: smallint("http_status"),
    // Clave completa del JSON en R2; se persiste, no se reconstruye.
    r2Key: text("r2_key"),
    queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
  },
  (t) => [
    index("audit_logs_route_profile_finished_idx").on(t.routeId, t.profile, t.finishedAt.desc()),
    index("audit_logs_project_finished_idx").on(t.projectId, t.finishedAt.desc()),
    index("audit_logs_status_queued_idx").on(t.status, t.queuedAt),
    // Idempotencia: una sola auditoría pendiente por ruta + perfil.
    uniqueIndex("audit_logs_pending_unique")
      .on(t.routeId, t.profile)
      .where(sql`${t.status} in ('queued', 'running')`),
    check(
      "audit_logs_scores_range",
      sql`(${t.scorePerformance} is null or ${t.scorePerformance} between 0 and 100)
        and (${t.scoreSeo} is null or ${t.scoreSeo} between 0 and 100)
        and (${t.scoreAccessibility} is null or ${t.scoreAccessibility} between 0 and 100)
        and (${t.scoreBestPractices} is null or ${t.scoreBestPractices} between 0 and 100)`,
    ),
  ],
);

// --------------------------------------------------------- alert_states
export const alertStates = pgTable(
  "alert_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    routeId: uuid("route_id")
      .notNull()
      .references(() => routes.id, { onDelete: "cascade" }),
    profile: auditProfile("profile").notNull(),
    kind: alertKind("kind").notNull(),
    // null cuando kind = audit_failure.
    metric: alertMetric("metric"),
    status: alertStateStatus("status").notNull().default("open"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    openedByAuditId: uuid("opened_by_audit_id").references(() => auditLogs.id, {
      onDelete: "set null",
    }),
    lastValue: smallint("last_value"),
    thresholdAtOpen: smallint("threshold_at_open"),
    lastNotifiedAt: timestamp("last_notified_at", { withTimezone: true }),
    reminderCount: smallint("reminder_count").notNull().default(0),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByAuditId: uuid("resolved_by_audit_id").references(() => auditLogs.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => [
    // Máximo un estado abierto por condición. Dos índices parciales (uno por tipo) porque
    // metric es null en audit_failure y castear un enum a texto no es IMMUTABLE en Postgres.
    uniqueIndex("alert_states_open_threshold_unique")
      .on(t.routeId, t.profile, t.metric)
      .where(sql`${t.status} = 'open' and ${t.kind} = 'threshold'`),
    uniqueIndex("alert_states_open_failure_unique")
      .on(t.routeId, t.profile)
      .where(sql`${t.status} = 'open' and ${t.kind} = 'audit_failure'`),
    index("alert_states_status_notified_idx").on(t.status, t.lastNotifiedAt),
    check(
      "alert_states_metric_matches_kind",
      sql`(${t.kind} = 'threshold' and ${t.metric} is not null)
        or (${t.kind} = 'audit_failure' and ${t.metric} is null)`,
    ),
  ],
);

// -------------------------------------------------------- notifications
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    type: notificationType("type").notNull(),
    channel: text("channel").notNull().default("email"),
    recipient: text("recipient").notNull(),
    subject: text("subject").notNull(),
    alertStateIds: uuid("alert_state_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    status: notificationStatus("status").notNull(),
    error: text("error"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notifications_project_sent_idx").on(t.projectId, t.sentAt.desc())],
);

// ----------------------------------------------------------- field_data
// Datos reales de usuarios (Chrome UX Report): lo último que devolvió Google para cada sitio o página y dispositivo.
// Es derivado y se vuelve a pedir cada día, por eso solo se guarda lo vigente y no entra en los respaldos.
export const fieldData = pgTable(
  "field_data",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // "origin" para todo el sitio, o el id de la ruta cuando es una página concreta.
    target: text("target").notNull(),
    routeId: uuid("route_id").references(() => routes.id, { onDelete: "cascade" }),
    formFactor: auditProfile("form_factor").notNull(),
    // ok = Google devolvió datos; no_data = el sitio o la página no tiene tráfico suficiente.
    status: text("status").notNull(),
    metrics: jsonb("metrics"),
    collectionFirst: text("collection_first"),
    collectionLast: text("collection_last"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("field_data_unique").on(t.projectId, t.target, t.formFactor),
    check("field_data_status", sql`${t.status} in ('ok', 'no_data')`),
  ],
);

// ------------------------------------------------------ seo_integrations
// Fuentes de datos del módulo SEO y visibilidad en IA, por proyecto. La cuenta de servicio de Google es una sola
// para todo el panel (vive cifrada en `settings`); aquí solo van el identificador de la propiedad y, para
// Cloudflare, el token de solo lectura (cifrado con AUTH_ENCRYPTION_KEY, igual que el acceso a páginas privadas).
export const seoIntegrations = pgTable(
  "seo_integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: seoIntegrationKind("kind").notNull(),
    // gsc: propiedad ("sc-domain:ejemplo.com" o "https://ejemplo.com/"); ga4: ID numérico; cloudflare: ID de zona.
    externalId: text("external_id").notNull(),
    credentialEnc: bytea("credential_enc"),
    status: seoIntegrationStatus("status").notNull().default("pending"),
    // Mensaje legible del último chequeo. Nunca contiene credenciales.
    detail: text("detail"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastOkAt: timestamp("last_ok_at", { withTimezone: true }),
    // Descarga de datos (solo gsc y ga4): hasta qué día hay datos guardados, cuándo se intentó y cómo salió.
    syncedThrough: date("synced_through", { mode: "string" }),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    syncStatus: seoIntegrationStatus("sync_status").notNull().default("pending"),
    // Mensaje legible de la última descarga. Nunca contiene credenciales.
    syncDetail: text("sync_detail"),
    ...timestamps,
  },
  (t) => [unique("seo_integrations_project_kind_unique").on(t.projectId, t.kind)],
);

// ------------------------------------------------------ seo_search_daily
// Search Console: totales por día, página, país y dispositivo. `page` es la ruta normalizada (sin host ni parámetros).
// La posición media de un grupo se calcula como position_sum / impressions (posición ponderada por impresiones).
export const seoSearchDaily = pgTable(
  "seo_search_daily",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    date: date("date", { mode: "string" }).notNull(),
    page: text("page").notNull(),
    // Código de tres letras que entrega Search Console, en minúsculas (col, usa, esp…).
    country: text("country").notNull(),
    // MOBILE, DESKTOP o TABLET.
    device: text("device").notNull(),
    clicks: integer("clicks").notNull().default(0),
    impressions: integer("impressions").notNull().default(0),
    positionSum: doublePrecision("position_sum").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.date, t.page, t.country, t.device] }),
    index("seo_search_daily_project_date_idx").on(t.projectId, t.date),
  ],
);

// ----------------------------------------------------- seo_traffic_daily
// GA4: sesiones y usuarios por día, página, país (nombre que entrega GA4) y grupo de canal (Organic Search, Direct…).
export const seoTrafficDaily = pgTable(
  "seo_traffic_daily",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    date: date("date", { mode: "string" }).notNull(),
    page: text("page").notNull(),
    country: text("country").notNull(),
    channel: text("channel").notNull(),
    sessions: integer("sessions").notNull().default(0),
    users: integer("users").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.date, t.page, t.country, t.channel] }),
    index("seo_traffic_daily_project_date_idx").on(t.projectId, t.date),
  ],
);

// -------------------------------------------------- seo_ai_referrals_daily
// GA4: sesiones que llegan desde asistentes de IA (chatgpt.com, perplexity…), por día, fuente y página de entrada.
export const seoAiReferralsDaily = pgTable(
  "seo_ai_referrals_daily",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    date: date("date", { mode: "string" }).notNull(),
    source: text("source").notNull(),
    page: text("page").notNull(),
    sessions: integer("sessions").notNull().default(0),
    users: integer("users").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.date, t.source, t.page] }),
    index("seo_ai_referrals_daily_project_date_idx").on(t.projectId, t.date),
  ],
);

// -------------------------------------------------------- mcp_api_keys
export const mcpApiKeys = pgTable("mcp_api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // sha256 de la clave; la clave en claro se muestra una sola vez al crearla.
  keyHash: text("key_hash").notNull().unique(),
  // Allowlist de tools MCP que esta clave puede usar.
  scopes: text("scopes")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  // Alcance por datos: con `all_access` la clave ve todos los clientes y proyectos; si no, solo los de `client_ids`
  // (con todos sus proyectos, también los futuros) y los de `project_ids`. Sin claves foráneas: un id de un cliente o
  // proyecto que ya no existe simplemente no da acceso a nada.
  allAccess: boolean("all_access").notNull().default(true),
  clientIds: uuid("client_ids").array().notNull().default(sql`'{}'::uuid[]`),
  projectIds: uuid("project_ids").array().notNull().default(sql`'{}'::uuid[]`),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  // Cuándo se cambió por última vez el secreto de la clave (null si nunca se rotó).
  rotatedAt: timestamp("rotated_at", { withTimezone: true }),
  // Conexiones OAuth (claude.ai web): la fila es la conexión; el token de acceso caduca y se renueva con el de refresco.
  oauthClientId: uuid("oauth_client_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  refreshHash: text("refresh_hash").unique(),
  prevRefreshHash: text("prev_refresh_hash"),
  refreshExpiresAt: timestamp("refresh_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ------------------------------------------------------- oauth_clients
// Aplicaciones registradas por registro dinámico (RFC 7591): clientes públicos, sin secreto. Su id es el `client_id`.
export const oauthClients = pgTable("oauth_clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  redirectUris: text("redirect_uris").array().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

// --------------------------------------------------------- oauth_codes
// Códigos de autorización: de un solo uso y de vida corta. Solo se guarda el sha256 del código. Los permisos y el alcance
// elegidos al autorizar viajan aquí hasta que el código se canjea por la conexión.
export const oauthCodes = pgTable("oauth_codes", {
  codeHash: text("code_hash").primaryKey(),
  clientId: uuid("client_id").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  keyName: text("key_name").notNull(),
  scopes: text("scopes").array().notNull(),
  allAccess: boolean("all_access").notNull(),
  clientIds: uuid("client_ids").array().notNull().default(sql`'{}'::uuid[]`),
  projectIds: uuid("project_ids").array().notNull().default(sql`'{}'::uuid[]`),
  adminId: uuid("admin_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

// --------------------------------------------------------- admin_users
// Admin único: la app crea la fila del primer arranque; no hay registro público.
export const adminUsers = pgTable("admin_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  // `owner`: la cuenta que administra el equipo (una sola); `admin`: administra todo lo demás.
  role: text("role").notNull().default("admin"),
  // Perfil: nombre visible y foto (clave del objeto en R2, bajo `_avatars/`).
  firstName: text("first_name"),
  lastName: text("last_name"),
  avatarKey: text("avatar_key"),
  // La cuenta la creó el propietario con una contraseña provisional y la persona aún no la cambió.
  provisionalPassword: boolean("provisional_password").notNull().default(false),
  ...timestamps,
});

// ---------------------------------------------------------- admin_invites
// Invitaciones para entrar al panel y enlaces de contraseña nueva. El token viaja solo en el enlace: aquí queda su sha256.
export const adminInvites = pgTable(
  "admin_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    // `invite`: crea la cuenta; `reset`: cambia la contraseña de una cuenta que ya existe.
    kind: text("kind").notNull().default("invite"),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: uuid("invited_by"),
    // Perfil que el propietario dejó preparado: al aceptar la invitación la cuenta nace con estos datos. `user_id` es el
    // id que tendrá la cuenta (la foto ya está en R2 bajo `_avatars/<user_id>/`).
    userId: uuid("user_id"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    avatarKey: text("avatar_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("admin_invites_email_idx").on(t.email)],
);

// ------------------------------------------------------------- settings
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
