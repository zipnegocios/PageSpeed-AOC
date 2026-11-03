# AOC PageSpeed

Auditorías Lighthouse (velocidad, accesibilidad, SEO, buenas prácticas) para los proyectos de clientes.
Monolito Next.js + worker BullMQ/Lighthouse independiente. Arquitectura y plan por milestones: ver el plan de implementación aprobado.

## Desarrollo local

```bash
cp .env.example .env
docker compose -f docker/docker-compose.dev.yml up -d   # postgres, redis, minio, mailpit
pnpm install
pnpm dev            # web en http://localhost:3000
pnpm worker:dev     # worker (otro terminal)
```

## Despliegue y CI

- Cada push a `main` despliega el servicio **web** por el webhook de EasyPanel. El worker **no** tiene
  webhook: se despliega con el botón Deploy cuando cambia algo que le afecta.
- `.github/workflows/ci.yml` solo corre a demanda (Actions > CI > Run workflow); no hay ejecuciones
  automáticas. Antes de cada push se corren en local `pnpm typecheck`, `pnpm lint`, `pnpm test`,
  `pnpm build`, `pnpm migrate:build` y `pnpm worker:build`.

## Worker de auditorías

El worker (BullMQ + Lighthouse + Chromium) es un proceso aparte: `docker/Dockerfile.worker`, una sola réplica.
Necesita `DATABASE_URL`, `REDIS_URL`, `R2_*` y, opcionalmente, `CHROME_PATH` y `AUDIT_*`
(ver `.env.example`; no usa SESSION_SECRET ni ADMIN_*). Para enviar las alertas por correo también
necesita `SMTP_*`, `EMAIL_FROM` y `APP_URL` (y opcionalmente `ALERT_EMAIL`); sin SMTP el worker arranca igual,
evalúa las alertas y lo avisa en los logs.

- Si no hay worker en línea, el botón **Auditar** se niega con un aviso (no deja filas bloqueadas).
- En local, para auditar sitios en `localhost` (el worker de producción los rechaza a propósito):
  `pnpm exec tsx scripts/dev-worker.ts`. Ese script no se incluye en la imagen.
- Prueba con Chromium y Lighthouse reales (opcional):
  `TEST_CHROME_PATH=/ruta/a/chrome pnpm exec vitest run --dangerouslyIgnoreUnhandledErrors tests/integration/lighthouse-real.test.ts`
- `pnpm worker:build` compila el worker y genera su `package.json` mínimo (`scripts/worker-manifest.mjs`).
- **Agendado:** un proyecto en producción tiene su propio cron semanal o diario (UTC, repartido por hash del
  id). Al dispararse, el worker pide móvil y escritorio de cada ruta monitoreada. Pasar a desarrollo, cambiar
  la frecuencia o archivar actualiza el agendador; si Redis no responde en ese momento, el cambio se guarda
  igual y la reconciliación lo corrige.
- **Direcciones legibles:** el panel usa el identificador (slug) del cliente y del proyecto, no UUID:
  `/admin/clientes/acme` y `/admin/clientes/acme/tienda` (el slug del proyecto solo es único dentro de su
  cliente, por eso va anidado). En el portal, `/c/<token>/tienda`. Los enlaces antiguos con UUID
  (`/admin/proyectos/<uuid>`, `/c/<token>/<uuid>`) siguen funcionando y redirigen a la dirección legible.
  El slug se fija al crear (forma la carpeta de R2) y no cambia al renombrar el cliente o el proyecto.
- **Archivar, restaurar y eliminar:** archivar un cliente o un proyecto es reversible: sale del panel, deja de
  auditarse y (en un cliente) su link del portal deja de funcionar. Lo archivado se ve en `/admin/archivados`,
  donde se puede **Restaurar** o **Eliminar definitivamente**. Eliminar solo se ofrece sobre lo ya archivado,
  pide escribir el nombre exacto y borra, junto con la fila, todo lo que cuelga de ella (rutas, auditorías,
  alertas, avisos, datos reales) y sus informes en R2 (`cliente/proyecto/` o `cliente/`). Si R2 falla no se
  elimina nada. Los respaldos diarios de Postgres conservan copias anteriores hasta que vence su retención.
- **Reconciliación:** al arrancar y cada 15 minutos, el worker corrige desfases entre Postgres y Redis
  (auditorías huérfanas, trabajos perdidos, agendadores que faltan o sobran). `/admin/cola` muestra el estado.
- **Despliegue:** un cambio que toca `src/worker`, `src/server` o las dependencias exige redesplegar **web y worker**.

## Alertas y correos

Solo en proyectos en **producción**. Tras cada auditoría el worker compara las puntuaciones con los umbrales
del proyecto (`src/server/domain/alert-state-machine.ts`, función pura con pruebas de tabla):

- Una alerta es una condición (ruta + perfil + métrica, o "la auditoría falla"). Se **abre una vez**, no se
  repite mientras siga igual y se **cierra sola** al recuperarse; una nueva caída es una alerta nueva.
- Un fallo definitivo (reintentos agotados) abre una alerta de fallo de auditoría; un éxito posterior la cierra.
- Cada 5 minutos el worker barre las alertas pendientes y envía **un correo por proyecto** (agrupado). Espera
  a que terminen las auditorías pendientes del proyecto para no mandar varios correos de una misma corrida.
  Mientras una alerta siga abierta, recuerda cada **7 días**. No se envía correo de recuperación.
- Un envío fallido queda en la bitácora (`notifications`) y se reintenta pasada una hora.
- Destinatario: `ALERT_EMAIL` si está definido; si no, el correo del administrador.
- Pasar a desarrollo silencia las alertas abiertas. `/admin/alertas` y la ficha del proyecto muestran las
  alertas, el registro de correos y un botón de **WhatsApp** (enlace `wa.me` con el mensaje prellenado,
  usando el teléfono del cliente) para avisarle.

## Portal del cliente e histórico

- **Link mágico:** `/c/<token>`, solo lectura y sin sesión. El token (32 bytes aleatorios) está en la ficha del
  cliente, donde se puede **rotar** (el anterior deja de funcionar) y **suspender** al cliente (el portal pasa a
  la pantalla de servicio suspendido). Ambos cambios surten efecto en la siguiente petición: el token se vuelve
  a comprobar siempre y las páginas no se cachean.
- Muestra solo los proyectos **en producción**: estado actual de cada página y perfil con su variación respecto
  a la auditoría anterior, "puntos por mejorar" (las alertas abiertas, sin códigos internos) y la evolución.
  Con un único proyecto abre directo en su detalle.
- Cada proyecto se autoriza con el cliente del token; un proyecto de otro cliente, de desarrollo o archivado
  responde 404, igual que un token inválido. Más de 30 enlaces inválidos desde una IP en 10 minutos cortan el
  acceso con un aviso (limitador en memoria; hay una sola réplica web).
- Cabeceras de `/c/*`: `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`.
- **Evolución:** gráfico sin scripts (SVG + HTML) de puntuaciones, LCP, TBT y CLS por página, perfil y periodo
  (7 días a 1 año), con la meta dibujada. Se elige con enlaces, así que cada vista tiene su URL. El mismo
  panel está en la ficha del proyecto del administrador, donde incluye también las rutas de pruebas.
- **Informe PDF:** A4 con estado actual (y su variación), puntos por mejorar y la evolución del rendimiento por
  página y perfil, en Rajdhani y con los colores de `design/tokens.json`. Lo descarga el administrador desde la
  ficha del proyecto (30 o 90 días) y el cliente desde su portal (`/c/<token>/<proyecto>/informe`, con la misma
  autorización que el portal). Se genera en el servicio web, de uno en uno y con una caché de 2 minutos para no
  cargar el VPS; las fuentes viajan en la imagen (`src/assets/fonts`, licencia OFL).
- **Envío por email:** el botón «Enviar a …» de la ficha del proyecto manda el PDF adjunto al correo de contacto
  del cliente, con un enlace a su portal, y lo anota en la bitácora (`notifications`, tipo `report`). Usa el
  SMTP del servicio web, no se puede repetir antes de 5 minutos y un fallo del SMTP se registra sin detener nada.
- **PWA:** cada portal publica su manifiesto (`/c/<token>/manifest.webmanifest`) y se puede instalar con el
  nombre del cliente. Iconos en `public/pwa` (origen: `design/icons/app-icon.svg`). No hay service worker: sin
  conexión el navegador lo dice, nunca se muestran puntuaciones viejas.

## Visor de auditorías (informe completo, idioma y agentes)

- **Informe oficial de Lighthouse**: se genera desde el JSON guardado en R2 (`lighthouse/report`) y se muestra en un marco
  aislado (`sandbox` sin `allow-same-origin`, CSP sin red, solo enmarcable por la propia app). Admin:
  `/admin/auditorias/<id>/informe`; cliente: `/c/<token>/<proyecto>/detalle/<auditoría>`. Se ocultan su menú de
  herramientas y el mapa de rectángulos externo. En rutas que exigen sesión, al cliente se le quitan capturas,
  fragmentos de HTML y textos de elementos (`redactLhr`).
- **Idioma**: el JSON se guarda una sola vez (inglés) y se traduce al leer con `swapLocale` de Lighthouse, también
  para auditorías ya guardadas. Selector Español/English (cookie `aoc_lang`, español por defecto); solo cambia los
  textos de Lighthouse.
- **Navegación con agentes** (`agentic-browsing`, Lighthouse 13): se mide y se guarda como superadas/totales
  (`audit_logs.agentic_passed/total`, migración `0001`). No es una nota 0-100, no tiene umbral y no genera alertas.
- `pnpm build` ejecuta `scripts/copy-lighthouse-assets.mjs`: el rastreo de Next no incluye el generador del informe en la
  imagen standalone, así que se copia tras compilar. **Despliega primero el web (aplica la migración) y luego el worker.**

### Panel nativo de la auditoría

- `/admin/auditorias/<id>` y, para el cliente, `/c/<token>/<proyecto>/detalle/<auditoría>` muestran el mismo visor
  (`src/app/_components/audit-viewer`): pestañas **Resumen**, una por categoría (Rendimiento, Accesibilidad, Buenas
  prácticas, SEO, Navegación con agentes), **Evidencias** e **Informe completo** (el oficial de Lighthouse).
- Cada categoría sigue las reglas de Lighthouse (`src/server/domain/lhr-view.ts`, puro y con pruebas): métricas con
  valoración, grupos en su orden, lo que falla primero (por ahorro), aprobadas / no aplicables / revisión manual
  plegadas, filtro por métrica (FCP, LCP, TBT, CLS), «Ampliar todo» y consejos por tecnología (stack packs).
- Los detalles de cada auditoría se dibujan como tablas (bytes, tiempos, URLs, elementos con selector y fragmento),
  listas, árboles de red y listas de control; máximo 50 filas por tabla y todo se escapa (nada de HTML de la página).
- **Evidencias**: la captura de página completa (`/api/admin/audits/<id>/captura`) con un recuadro numerado sobre cada
  elemento de la auditoría elegida. **Mapa de scripts**: rectángulos proporcionales al tamaño (`treemap.ts`) con la
  parte sin usar. En el portal, las rutas que exigen sesión no ofrecen capturas ni evidencias.

### Datos reales de usuarios (Chrome UX Report)

- Tarjeta **Datos reales de usuarios** en la ficha del proyecto y en el portal: la experiencia de visitantes reales de Chrome
  en los últimos 28 días (LCP, **INP**, CLS, FCP y TTFB, percentil 75 y reparto bueno / mejorable / deficiente) y la
  evaluación de Core Web Vitals, para todo el sitio o una página, en móvil y escritorio. Es lo que el laboratorio de
  Lighthouse no puede medir; no genera alertas.
- El worker los pide a la API de CrUX cada día (04:47 UTC) para el sitio y hasta 10 páginas monitoreadas de cada proyecto en
  producción, con una pausa entre consultas (límite gratuito: 150 por minuto), y los guarda en `field_data` (solo lo
  vigente; no entra en los respaldos). El botón **Actualizar datos reales** lo pide ahora.
- Requiere `CRUX_API_KEY` **solo en el worker** (clave de la API «Chrome UX Report API» de Google Cloud, restringida a esa
  API). Va en una cabecera, nunca en la dirección. Sin ella el panel lo dice. Un sitio o página con poco tráfico en Chrome no
  tiene datos: se muestra como «sin datos», no como un fallo.

## Páginas privadas (inicio de sesión)

- Una ruta marcada **«Requiere sesión»** se audita con el acceso del proyecto (tarjeta *Acceso a páginas privadas* de la ficha).
  Dos métodos: **formulario** (página de login + usuario y contraseña de prueba; selectores opcionales) o **cookies**
  pegadas (`nombre=valor`). Usa siempre un usuario de prueba dedicado, nunca una cuenta real de administración.
- Las credenciales se guardan **cifradas con AES-256-GCM** (`projects.auth_config_enc`) con `AUTH_ENCRYPTION_KEY`
  (`openssl rand -base64 32`), que debe ser **la misma en el web y en el worker**. La clave solo vive en el entorno: ni la
  base ni los respaldos la contienen. Sin ella no se pueden guardar credenciales (la tarjeta lo avisa). La pantalla nunca
  muestra contraseñas ni valores de cookies, y ni los logs ni los errores los incluyen.
- El worker abre Chromium, inicia sesión con `puppeteer-core` en una pestaña y Lighthouse audita **esa misma pestaña** sin
  borrar la sesión. Las credenciales solo se escriben en páginas de **hosts permitidos** (si el login redirige a otro host,
  se aborta) y la IP del host de login se valida y se fija igual que la de la página.
- Si la página privada termina en el inicio de sesión (cookies caducadas o login que no dejó sesión) la auditoría falla con
  `AUTH_FAILED`. `AUTH_NOT_CONFIGURED` (ruta privada sin acceso) y `AUTH_CONFIG` (clave que no descifra) tampoco se
  reintentan: abren la alerta de fallo de auditoría y esperan a que alguien las corrija.
- No admite doble factor ni captcha. Pruebas con Chromium real (opt-in): `tests/integration/lighthouse-auth-real.test.ts`.

## Agentes (MCP)

- Servidor MCP en `POST /api/mcp` (Streamable HTTP, **sin sesión**: cada petición crea su servidor y lo libera).
  Autenticación con `Authorization: Bearer aoc_...`; las claves se crean y revocan en **Panel → Agentes**, se
  muestran una sola vez y en la base solo queda su sha256. Un `Origin` ajeno se rechaza (anti DNS-rebinding).
- Tres niveles de permisos (presets): solo lectura, + auditorías, + configuración. La clave guarda los nombres
  de las herramientas permitidas; las demás ni aparecen en `tools/list`. Ninguna herramienta borra, cambia la
  fase, rota links ni suspende clientes.
- Límites en memoria: 60 llamadas por minuto por clave y 20 claves inválidas cada 10 minutos por IP.
- `run_audit` reutiliza `requestAudit` (idempotente, exige worker en línea, respeta la fase) con `trigger = mcp` y
  `requested_by = mcp:<nombre de la clave>`. Con una URL crea una ruta puntual (`source = adhoc`, sin monitoreo),
  limitada a los hosts permitidos del proyecto y a 50 por proyecto.
- La capa `src/mcp` solo llama a servicios (la misma lógica que el panel). Guía para agentes: `docs/mcp-skill.md`.
- Probar con el inspector oficial: `npx @modelcontextprotocol/inspector` (transporte HTTP, cabecera Authorization);
  las pruebas de integración usan el cliente MCP real del SDK.

## Operación, respaldos y endurecimiento

- **Runbook:** `docs/runbook.md` (recursos, despliegues, incidentes, rotación de secretos, prueba de aceptación).
- **Respaldos:** el worker copia cada día (03:17 UTC) toda la base a R2 (`_backups/postgres/...`) como NDJSON comprimido,
  leído en una transacción con snapshot (coherente aunque se siga escribiendo) y sin depender de `pg_dump`.
  Retención: 30 días y siempre los 5 más recientes. El estado, la lista y *Respaldar ahora* están en **Cola → Respaldos**;
  un fallo se anota, se muestra y se avisa por correo.
- **Restauración:** `node restore-cli.cjs --list | latest [--dry-run] | <clave> | --file <archivo>` desde la consola del
  servicio web (`dist/restore-cli.cjs` va en la imagen). Es transaccional y exige una base vacía con las migraciones aplicadas.
- **Cabeceras de seguridad** en toda la app (`nosniff`, `X-Frame-Options: DENY`, HSTS, Permissions-Policy, COOP); el
  portal añade `no-referrer`, `noindex` y `no-store`. Sin CSP todavía (Next inyecta scripts en línea y necesita nonces).
- **Imágenes:** el web limita el heap de Node (512 MB) y declara un `HEALTHCHECK` que no mira la base (una caída de
  Postgres no reinicia el web); el worker, igual con 512 MB para Node (Chromium va aparte).
- Para el worker, un cambio en respaldos exige **redesplegarlo a mano**; el web se despliega solo.

## Design System

La fuente de verdad del diseño es el Design System "AOC PageSpeed" (Rajdhani, azules tecnológicos, rojos sutiles).
`design/tokens.json` es su espejo; no se editan valores en código. Para aplicar un cambio:

1. Cambia el valor en el Design System.
2. Copia su `tokens.json` a `design/tokens.json`.
3. `pnpm tokens:sync` regenera `src/lib/ui/tokens/*` (CI verifica que no haya diferencias).

## Capas

`app/**` y `mcp/**` → `server/services` → `server/repositories` → `server/db`. `server/**` y `worker/**` no importan `next/*` (regla ESLint).
