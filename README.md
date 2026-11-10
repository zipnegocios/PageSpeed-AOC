# PageSpeed

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
- **Primer escaneo de todas las rutas:** en la tarjeta *Rutas* de la ficha del proyecto, junto a «Descubrir desde el sitemap»,
  el bloque «Primer escaneo» audita en móvil y escritorio las rutas **monitoreadas** que aún no tienen una auditoría correcta
  ni pendiente (lo que falló antes se reintenta; las rutas que piden sesión se omiten mientras el proyecto no tenga el acceso
  configurado). Encola con prioridad de lote (por detrás de un «Auditar» individual) y respeta el límite de 50 trabajos
  esperando: rutas completas hasta llenar el cupo; si faltan, el mensaje lo dice y se repite el botón cuando avance la cola.
  Lógica en `planFirstScan` (`server/domain/audit-rules.ts`) y `requestFirstScan` (`server/services/audits.ts`).
- En local, para auditar sitios en `localhost` (el worker de producción los rechaza a propósito):
  `pnpm exec tsx scripts/dev-worker.ts`. Ese script no se incluye en la imagen.
- Prueba con Chromium y Lighthouse reales (opcional):
  `TEST_CHROME_PATH=/ruta/a/chrome pnpm exec vitest run --dangerouslyIgnoreUnhandledErrors tests/integration/lighthouse-real.test.ts`
- `pnpm worker:build` compila el worker y genera su `package.json` mínimo (`scripts/worker-manifest.mjs`).
- **Agendado:** un proyecto en producción tiene su propio cron semanal o diario (UTC, repartido por hash del
  id). Al dispararse, el worker pide móvil y escritorio de cada ruta monitoreada. Pasar a desarrollo, cambiar
  la frecuencia o archivar actualiza el agendador; si Redis no responde en ese momento, el cambio se guarda
  igual y la reconciliación lo corrige.
- **Panel de inicio (`/admin`):** el primer pantallazo tras el login, organizado en paneles sólidos con esquinas HUD sobre una
  retícula técnica: resumen de la flota (rendimiento medio, SEO/Accesibilidad/Buenas prácticas, alertas, en curso), una
  tarjeta por proyecto (anillos de puntuación, agentes, miniatura de 30 días, última auditoría), auditorías recientes de
  todos los proyectos (un clic abre la auditoría), alertas, cola/worker y últimos fallos. Cada panel carga por separado
  (Suspense). Los datos salen de `services/dashboard.ts`: `getFleet` hace 5 consultas sea cual sea el número de proyectos.
- **Auditorías por página, con pestañas Móvil / Escritorio:** en la ficha del proyecto hay una tarjeta por página
  (inicio, contacto…) con sus dos dispositivos en pestañas: puntuaciones con su variación, agentes, LCP/TBT/CLS, las
  últimas 5 auditorías de ese dispositivo y «Auditar este dispositivo». Cambiar de pestaña no recarga (ambos paneles ya
  están en la página; teclado: flechas, Inicio y Fin). Dentro de una auditoría, «Móvil 86 | Escritorio 92» pasa a la
  versión del otro dispositivo de la misma página. Lo mismo en el portal del cliente (tarjeta por página con pestañas y
  selector en el detalle técnico) y en el panel de inicio (una fila por página con las dos fichas). El historial
  cronológico completo sigue en la ficha, plegado. Datos: `services/pages.ts` (`getPageAudits`: 3 consultas),
  `getSiblingAudits`, `getPortalSiblings` y `groupAuditsByPage`.
- **Acceso directo a un proyecto:** menú «Proyectos» (`/admin/proyectos`, con búsqueda y filtro de fase) y el
  conmutador «Ir a un proyecto» de la barra superior (`/` o Ctrl/Cmd+K, busca por proyecto o cliente sin acentos, flechas
  y Enter). En la ficha del proyecto las «Auditorías recientes» van al principio.
- **Estilo HUD (Midnight Navy + Electric Lime):** una sola apariencia, siempre oscura, para el panel, el portal y el login
  (los valores `light` de `design/tokens.json` solo los usan el PDF y los correos). Fondo `#111827` con retícula técnica
  y marcas de mira en CSS, paneles sólidos con borde de 1 px y corchetes lima en dos esquinas, títulos en mayúsculas con
  corte lima, microtexto técnico en los paneles del inicio y radios casi rectos. Tipografía: Rajdhani. Lima = acento y
  estado sano; ámbar = mejorable; rojo = deficiente (siempre con número y palabra). Sin vidrio, desenfoque ni brillo;
  el movimiento se apaga con `prefers-reduced-motion`. Gráficos en SVG desde el servidor (anillos y miniaturas), con
  paleta de series `chart-1..3`. `pnpm contrast:check` (también en CI y en `tests/unit/contrast.test.ts`) comprueba los
  contrastes. El icono PWA (`design/icons/app-icon.svg`) se rasteriza a `public/pwa/*.png` con Playwright
  (`chromium` + `page.screenshot` a 192, 512 y 180 px).
- **Direcciones legibles:** el panel usa el identificador (slug) del cliente y del proyecto, no UUID:
  `/admin/clientes/acme` y `/admin/clientes/acme/tienda` (el slug del proyecto solo es único dentro de su
  cliente, por eso va anidado). Los enlaces antiguos con UUID siguen funcionando y redirigen.
- **Portal del cliente:** un solo enlace, fijo: `/c/<identificador-del-cliente>`, protegido con un **PIN de 6
  dígitos**. Se genera desde la ficha del cliente («Generar PIN», o «Generar y enviar al correo») y el último PIN
  generado queda siempre visible ahí («PIN actual»). Se guarda cifrado (AES-256-GCM con `AUTH_ENCRYPTION_KEY`, la
  clave no está en la base ni en los respaldos) y, para validar, su huella (HMAC con `SESSION_SECRET`). Sin esa
  clave el PIN funciona, pero la ficha dice «No disponible» hasta generar otro. Con el PIN correcto
  el navegador recibe una sesión de 30 días (cookie HttpOnly, solo bajo `/c`); un PIN nuevo la cierra. El
  cliente puede pedir un PIN nuevo desde la pantalla del PIN: le llega al correo de contacto de su ficha (máx.
  uno cada 15 minutos por cliente y 5 por hora por IP; la respuesta no revela si el cliente o el correo existen).
  Defensas: 5 PIN erróneos cada 15 min por IP y cliente, 25 por cliente en total, y una dirección que no existe
  se ve igual que una real. Suspender al cliente muestra el aviso con el contacto (`src/lib/contact.ts`) y un botón
  de WhatsApp, sin pedir PIN. El enlace antiguo con token (`/c/<token>`) ya no da acceso: solo redirige a la
  pantalla del PIN (la columna `magic_token` se conserva solo para eso). El informe por correo usa este enlace.
- **Renombrar identificadores:** en la ficha del cliente o del proyecto. El anterior pasa a la lista de alias
  (`slug_aliases`): sigue funcionando en los enlaces viejos y queda reservado, así nadie más puede tomarlo. Los
  informes ya guardados en R2 no se mueven (cada auditoría guarda su clave completa) y los nuevos van a la
  carpeta nueva; al eliminar, se borran todas las carpetas.
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

- **Acceso:** `/c/<identificador-del-cliente>` con PIN (ver arriba), solo lectura. Desde la ficha del cliente se
  genera el PIN y se **suspende** al cliente (el portal pasa al aviso de servicio suspendido). Los cambios surten
  efecto en la siguiente petición: el acceso se vuelve a comprobar siempre y las páginas no se cachean.
- Muestra solo los proyectos **en producción**: estado actual de cada página y perfil con su variación respecto
  a la auditoría anterior, "puntos por mejorar" (las alertas abiertas, sin códigos internos) y la evolución.
  Con un único proyecto abre directo en su detalle.
- Cada proyecto se autoriza con el cliente de la sesión; un proyecto de otro cliente, de desarrollo o archivado
  responde 404. Más de 30 enlaces mal formados desde una IP en 10 minutos cortan el acceso con un aviso
  (limitadores en memoria; hay una sola réplica web).
- Cabeceras de `/c/*`: `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`.
- **Evolución:** gráfico sin scripts (SVG + HTML) de puntuaciones, LCP, TBT y CLS por página, perfil y periodo
  (7 días a 1 año), con la meta dibujada. Se elige con enlaces, así que cada vista tiene su URL. El mismo
  panel está en la ficha del proyecto del administrador, donde incluye también las rutas de pruebas.
- **Informe PDF:** A4 con estado actual (y su variación), puntos por mejorar y la evolución del rendimiento por
  página y perfil, en Rajdhani y con los colores de `design/tokens.json`. Lo descarga el administrador desde la
  ficha del proyecto (30 o 90 días) y el cliente desde su portal (`/c/<cliente>/<proyecto>/informe`, con la misma
  autorización que el portal). Se genera en el servicio web, de uno en uno y con una caché de 2 minutos para no
  cargar el VPS; las fuentes viajan en la imagen (`src/assets/fonts`, licencia OFL).
- **Envío por email:** el botón «Enviar a …» de la ficha del proyecto manda el PDF adjunto al correo de contacto
  del cliente, con un enlace a su portal, y lo anota en la bitácora (`notifications`, tipo `report`). Usa el
  SMTP del servicio web, no se puede repetir antes de 5 minutos y un fallo del SMTP se registra sin detener nada.
- **PWA:** cada portal publica su manifiesto (`/c/<cliente>/manifest.webmanifest`) y se puede instalar con el
  nombre del cliente. Iconos en `public/pwa` (origen: `design/icons/app-icon.svg`). No hay service worker: sin
  conexión el navegador lo dice, nunca se muestran puntuaciones viejas.

## Bienvenida al cliente

Un solo correo que explica el servicio y da el acceso al portal (link y PIN), firmado por zipnegocios. Se envía desde la
ficha del cliente, tarjeta **Bienvenida** (`services/client-welcome.ts`, plantilla en `notify/client-emails.ts`).

- **Qué pide el formulario:** el proyecto del que habla (solo en producción), qué es (sitio, tienda o aplicación), la
  tecnología (texto libre, con sugerencias), si el plan incluye supervisar servidor, servicios y APIs, y las personas en
  copia (una por línea, «Nombre <correo>»). Todo se guarda (`projects.kind/tech_label/includes_server`,
  `clients.cc_contacts`) y se rellena solo en los envíos siguientes.
- **Destinatarios:** va **Para** el correo de contacto del cliente y **CC** a las personas en copia; el saludo nombra a todas
  por su nombre de pila («Hola Ana, Luis y María,»; los compuestos frecuentes se respetan: «Ana María Osorio» → «Ana María»).
  Con una persona habla de «tú»; con varias, de «ustedes». **Dos personas pueden compartir una dirección** (incluida la del
  contacto principal): se escriben en líneas aparte con la misma dirección, se nombran las dos y el correo llega una sola vez.
  Las direcciones en copia nunca se repiten.
- **Quién firma: el responsable del cliente.** Los clientes reconocen a la persona (nombre y apellido) antes que a la marca. Cada
  cliente tiene un **responsable** (`clients.owner_id`): quien lo crea queda como responsable y se puede reasignar en su ficha
  (tarjeta «Responsable»). Todos los correos que ve el cliente (bienvenida, semanal, mensual, informes a mano y PIN) llevan en la
  cabecera el logo de PageSpeed y, junto a él, el **nombre del responsable**; debajo «zipnegocios · Informes técnicos web»; y la
  firma y el pie con su nombre y su **WhatsApp** (el teléfono se guarda en «Mi perfil», `admin_users.phone`; sin teléfono, el pie
  no muestra WhatsApp; la cuenta propietaria conserva el de siempre mientras no ponga el suyo). Sin responsable (clientes
  anteriores, o una cuenta que ya no existe) firma la cuenta propietaria (`services/client-sender.ts`, `resolveSender`). La
  bienvenida se presenta («Soy Luis Porteles (zipnegocios)… te escribo desde esta dirección nueva; si no la reconoces, es
  normal, soy yo»). Los correos al administrador (alertas, invitaciones) siguen con la marca del producto.
- **Lo que cambia con el responsable:** el nombre visible del remitente (`fromName`; la dirección de envío es siempre la de
  `EMAIL_FROM`, así que la entrega no cambia), el `Reply-To` (el correo del responsable: las respuestas le llegan a él), las
  **alertas** de los proyectos (a los clientes de otra persona del equipo les avisa esa persona; a los de la cuenta propietaria
  y a los sin responsable, `ALERT_EMAIL` o el administrador, como siempre) y el contacto del aviso de **servicio suspendido** del
  portal (nombre y WhatsApp del responsable). Cada administrador sigue viendo todos los clientes.
- **Remitente y respuestas:** `EMAIL_FROM` fija la dirección de envío (el nombre visible lo pone el responsable de cada cliente);
  `EMAIL_REPLY_TO` (opcional, web y worker) es adonde responde el cliente cuando el responsable no tiene correo. El PIN nuevo también llega a todo el equipo (contacto principal y copia), y el informe enviado a mano igual.
- **PIN:** si el cliente ya tiene un PIN que se puede mostrar, se reutiliza (no se cierran sesiones). Si no, se genera uno
  nuevo, y solo se activa si el correo salió. El portal sigue siendo un único acceso por cliente.
- **Prueba:** la casilla «Enviarme solo una prueba» manda el mismo correo, con los mismos datos, al correo del administrador
  que tiene la sesión abierta: no se envía al cliente, no se guarda nada y no cambia el PIN.
- **Frenos y bitácora:** no se repite antes de 5 minutos; cada envío queda en la bitácora de correos (tipo «Bienvenida»,
  también los fallidos). El dato de fin de soporte (PHP o Node.js) depende de la tecnología y **caduca solo** (ver
  `domain/client-welcome.ts`; revisar cada trimestre).
- **Correos de prueba con datos de ejemplo:** desde la consola del servicio web, `node send-test-emails-cli.cjs <correo>`
  envía los cuatro correos del servicio (bienvenida, estado mensual, semana en la web e informe manual). Ver
  `scripts/send-test-emails.ts` para las opciones.
- El semanal y el mensual automáticos se encienden aparte (ver «Correos automáticos al cliente»).

## Correos automáticos al cliente

Dos correos con la marca de zipnegocios, para el contacto principal y su equipo en copia (plantillas en
`notify/client-emails.ts`, datos y envío en `services/client-reports.ts`, reglas puras en `domain/client-reports.ts`).
**Están apagados por defecto**: se encienden por cliente en su ficha, tarjeta «Correos automáticos».

- **Semanal, «Tu semana en la web»:** visitas de la última semana completa (lunes a domingo, UTC) frente a la anterior, de
  dónde llegaron (el reparto completo por origen, con cada red social por su nombre y «Directo o sin identificar»), clics de Google y con qué palabras buscaron, visitas
  desde asistentes de IA (aparte, como mínimo observado: ya están contadas en otros orígenes) y las 3 páginas más vistas. Solo
  sale si GA4 está conectado y el tráfico es visible para el cliente. Nunca con una semana a medias: si los datos de GA4 no
  llegan al domingo, espera; sale lunes, martes o miércoles, y pasado eso se omite esa semana. Con menos de 50 visitas no
  muestra porcentajes. La frase «En una línea» describe lo medido y nunca atribuye una causa.
- **Mensual, «Estado general»:** el primer lunes del mes (o los dos días siguientes) con el mes anterior completo. Promedios de
  las auditorías correctas en producción (rendimiento, SEO y accesibilidad, móvil y escritorio) frente al mes anterior, el
  registro de actuaciones del mes, las páginas nuevas del sitemap ya vigiladas y el estado (por reglas: alertas abiertas, mejora
  del móvil, lo atendido). No sale si ese mes no hubo auditorías. «Servidor y servicios: supervisados, sin incidencias» solo
  aparece si el administrador confirmó la revisión de ese mes (hoy es manual). Además suma «Experiencia real de tus visitantes»
  (veredicto de Core Web Vitals del Chrome UX Report), «Visitas del mes» con sus orígenes y «Visibilidad en Google» con las
  búsquedas principales (estos dos solo con el tráfico visible para el cliente y el mes completo descargado), y enlaza los dos PDF.
- **Informe a mano («Enviar a …»):** misma plantilla (`buildClientReportEmail`), con los **dos PDF adjuntos**, el índice real de cada
  uno y tres cifras (velocidad, visitas, Google) leídas de lo mismo que el portal.
- **Cuándo corre:** el worker revisa una vez al día (13:00 UTC, trabajo `client-reports` de la cola `maintenance`) y envía lo
  que toca. Cada envío queda en `client_report_sends` (un registro por proyecto, tipo y periodo: lo ya enviado no se repite; lo
  omitido o fallido se reintenta al día siguiente mientras la ventana siga abierta) y en la bitácora de correos. El worker
  necesita `SMTP_*`, `EMAIL_FROM` y `APP_URL` (sin SMTP lo avisa en los logs y no envía). **El worker no se despliega solo:
  tras publicar este cambio, pulsa Deploy en EasyPanel.**
- **En la ficha del proyecto**, tarjeta «Correos al cliente»: registro de actuaciones (`project_actions`; lo que anotes sale en
  «Lo que atendimos»), confirmación mensual de la revisión del servidor (`server_checks`), pruebas con datos reales («Enviarme el
  semanal / mensual de prueba»: solo a tu correo, sin dejar rastro) y el historial de envíos.
- Se envía un correo por cada proyecto en producción del cliente.

## Visor de auditorías (informe completo, idioma y agentes)

- **Informe oficial de Lighthouse**: se genera desde el JSON guardado en R2 (`lighthouse/report`) y se muestra en un marco
  aislado (`sandbox` sin `allow-same-origin`, CSP sin red, solo enmarcable por la propia app). Admin:
  `/admin/auditorias/<id>/informe`; cliente: `/c/<cliente>/<proyecto>/detalle/<auditoría>`. Se ocultan su menú de
  herramientas y el mapa de rectángulos externo. En rutas que exigen sesión, al cliente se le quitan capturas,
  fragmentos de HTML y textos de elementos (`redactLhr`).
- **Idioma**: el JSON se guarda una sola vez (inglés) y se traduce al leer con `swapLocale` de Lighthouse, también
  para auditorías ya guardadas. Selector Español/English (cookie `pagespeed_lang`, español por defecto); solo cambia los
  textos de Lighthouse.
- **Navegación con agentes** (`agentic-browsing`, Lighthouse 13): se mide y se guarda como superadas/totales
  (`audit_logs.agentic_passed/total`, migración `0001`). No es una nota 0-100, no tiene umbral y no genera alertas.
- `pnpm build` ejecuta `scripts/copy-lighthouse-assets.mjs`: el rastreo de Next no incluye el generador del informe en la
  imagen standalone, así que se copia tras compilar. **Despliega primero el web (aplica la migración) y luego el worker.**

### Panel nativo de la auditoría

- `/admin/auditorias/<id>` y, para el cliente, `/c/<cliente>/<proyecto>/detalle/<auditoría>` muestran el mismo visor
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
  Autenticación con `Authorization: Bearer pagespeed_...`; las claves se crean y revocan en **Panel → Agentes**, se
  muestran una sola vez y en la base solo queda su sha256. Un `Origin` ajeno se rechaza (anti DNS-rebinding).
- Tres niveles de permisos (presets): solo lectura, + auditorías, + configuración. La clave guarda los nombres
  de las herramientas permitidas; las demás ni aparecen en `tools/list`. Ninguna herramienta borra, cambia la
  fase, rota links ni suspende clientes.
- **Alcance por datos:** cada clave llega a todos los clientes y proyectos (`all_access`) o solo a una lista de
  clientes (con todos sus proyectos, también los futuros) y proyectos sueltos (`client_ids`, `project_ids`). Cada
  herramienta lo comprueba antes de leer o cambiar (`src/mcp/access.ts`, reglas en `server/domain/mcp-access.ts`);
  lo que queda fuera responde «no encontrado», como si no existiera. Al crear la clave hay que elegir una de las dos
  cosas.
- **Conector de claude.ai (OAuth):** los conectores personalizados de claude.ai web no permiten poner una cabecera
  `Authorization`, solo hablan OAuth. La app es su propio servidor de autorización mínimo: descubrimiento
  (`/.well-known/oauth-protected-resource` y `/.well-known/oauth-authorization-server`), registro dinámico
  (`/oauth/register`), pantalla de autorización con sesión de administrador (`/oauth/authorize`, donde se eligen permisos y
  alcance como en «Nueva clave»), `/oauth/token` (código + PKCE S256, y refresco rotativo) y `/oauth/revoke`. Cada
  conexión es una fila de `mcp_api_keys` (insignia «Conexión de claude.ai»): accesos de 1 hora, refrescos de 90 días,
  reutilizar un refresco gastado la revoca, y se edita, revoca y elimina desde Panel → Agentes como cualquier clave.
  Solo se aceptan direcciones de retorno de `claude.ai`/`claude.com` y de bucle local. Requiere `APP_URL` con la URL
  pública https exacta. Las claves por cabecera (`Authorization: Bearer pagespeed_…`) siguen valiendo para Claude Code.
- **Gestión de claves** (Panel → Agentes): cada clave se puede **editar** (nombre, permisos y alcance; vale desde la
  siguiente llamada del agente y la clave no cambia), **rotar** (genera un secreto nuevo, se muestra una sola vez, y el
  anterior deja de servir al instante), **revocar** (deja de servir al instante; sigue en la lista) y, ya revocada,
  **eliminar** definitivamente (hay que escribir su nombre). Rotar y revocar piden confirmar antes de actuar. Las
  auditorías que lanzó una clave conservan su nombre como texto.
- Límites en memoria: 60 llamadas por minuto por clave y 20 claves inválidas cada 10 minutos por IP.
- `run_audit` reutiliza `requestAudit` (idempotente, exige worker en línea, respeta la fase) con `trigger = mcp` y
  `requested_by = mcp:<nombre de la clave>`. Con una URL crea una ruta puntual (`source = adhoc`, sin monitoreo),
  limitada a los hosts permitidos del proyecto y a 50 por proyecto.
- La capa `src/mcp` solo llama a servicios (la misma lógica que el panel). Guía para agentes: `docs/mcp-skill.md`.
- Probar con el inspector oficial: `npx @modelcontextprotocol/inspector` (transporte HTTP, cabecera Authorization);
  las pruebas de integración usan el cliente MCP real del SDK.

## SEO y visibilidad (en construcción)

Módulo aparte, dentro del mismo panel, para medir cómo se encuentra y se usa cada sitio: búsqueda (Search Console), visitas
(GA4), bots de IA (Cloudflare) y, más adelante, auditoría SEO técnica y presencia en asistentes de IA. Diseño, plan y fases en
el documento de diseño del módulo; lo que existe hoy es la **primera pieza: las conexiones**.

- **Menú SEO** (`/admin/seo`): la **cuenta de servicio de Google** se configura una sola vez para todo el panel, de dos formas: con la
  variable de entorno **`GOOGLE_SERVICE_ACCOUNT_JSON`** en el servicio web (el JSON de la llave en una línea, o ese JSON en base64:
  `base64 -w0 llave.json`; manda sobre la otra y no se guarda en la base), o pegando la llave en pantalla (se comprueba con Google al
  guardar y queda cifrada con `AUTH_ENCRYPTION_KEY` en `settings`). En ambos casos solo se muestra su correo. **No sirve una clave de
  API**: Search Console y GA4 acceden a datos privados y exigen una cuenta de servicio (OAuth). Debajo, el estado de las conexiones de cada proyecto.
- **Pestaña SEO de un proyecto** (`/admin/clientes/<cliente>/<proyecto>/seo`, con acceso desde su ficha): una tarjeta por fuente
  (Search Console, GA4, Cloudflare) con los pasos para dar acceso al correo de la cuenta de servicio, el campo del identificador
  (propiedad de GSC, ID numérico de GA4, ID de zona y token de Cloudflare, cifrado) y **Probar conexión**, que responde en español
  qué corregir (por ejemplo, «agrega este correo con el rol Lector»). Los identificadores se validan y normalizan al guardar.
- Datos: tabla `seo_integrations` (migración `0009`), una fila por proyecto y fuente; **entra en los respaldos diarios**. El código de
  los clientes de Google y Cloudflare vive en `src/server/seo/` y lo comparten la plataforma y los scripts del piloto
  (`scripts/spike-seo/`, ver su README). Servicio: `services/seo-connections.ts`; reglas puras: `domain/seo-connections.ts`.
- **Descarga de datos (fase 1):** el worker tiene una cola propia, `seo`, y cada día (05:37 UTC) descarga Search Console y GA4 de todos
  los proyectos vigentes con esas conexiones; también hay «Actualizar ahora» por proyecto. La primera vez trae 90 días y después repasa
  los últimos 7 (Google corrige con retraso: Search Console tarda ~3 días en cerrar, GA4 ~1). Guarda totales por día en
  `seo_search_daily` (página, país, dispositivo, clics, impresiones y posición × impresiones), `seo_traffic_daily` (página, país y grupo
  de canal) y `seo_ai_referrals_daily` (visitas desde ChatGPT, Perplexity, Gemini…), con la página normalizada a ruta. Repetir una
  descarga no duplica nada (cada ventana se reemplaza en una transacción) y un fallo a la mitad conserva lo ya guardado. El resultado
  de cada fuente queda en `seo_integrations` (`synced_through`, `last_sync_at`, `sync_status`, `sync_detail`). Todo entra en los
  respaldos. Código: `domain/seo-sync.ts` (ventanas y agregación, puro), `services/seo-sync.ts` y `repositories/seo-sync.ts`.
  **El worker necesita `GOOGLE_SERVICE_ACCOUNT_JSON` (o `AUTH_ENCRYPTION_KEY` si la cuenta se guardó en el panel).**
- **Pantalla «Tráfico y búsqueda»** (arriba de las conexiones, en la pestaña SEO del proyecto, si hay conexión a Search Console o GA4):
  periodo de 7, 28 o 90 días (`?periodo=`), estado de la última descarga de cada fuente y botón «Actualizar ahora»; indicadores con su
  variación frente al periodo anterior (clics, impresiones, CTR, posición media —bajar es mejor—, sesiones y visitas desde IA); gráficos
  diarios; y rankings de páginas, países, dispositivos y canales, y de visitas desde ChatGPT, Perplexity, Gemini y otros. **Cada fuente
  termina en su último día con datos** (Search Console cierra ~3 días tarde y GA4 ~1), y la pantalla muestra el periodo de cada una, para
  que ni caiga a cero al final ni se compare contra menos días. No se muestran «usuarios»: GA4 los entrega por día, página, país y canal, y
  sumarlos cuenta varias veces a la misma persona. Código: `domain/seo-data.ts` (puro), `services/seo-data.ts`
  (`getSeoDashboard`, solo agregaciones SQL) y `app/admin/seo/_components/`.
- **Visitas desde IA (fase 3, alcance reducido):** la cifra «Visitas desde IA» y la sección «Visitas desde asistentes de IA» de
  «Tráfico y búsqueda» (también en el portal del cliente, si se activó) se presentan siempre como **mínimo observado**: son las
  sesiones que GA4 atribuye a ChatGPT, Perplexity, Claude, Gemini o Copilot por su sitio de referencia, y parte de las visitas desde
  un chat llega sin referido y GA4 la cuenta como tráfico directo. La cifra muestra además su peso en las sesiones; sirve para
  ver la tendencia, no como total. Se decidió **no construir** por ahora la lectura de bots de IA de Cloudflare, la importación de
  CSV ni el sondeo a las APIs de los asistentes (plan de la fase 3, diferido).
- **Idiomas del sitio (fase 1b):** la tarjeta «Idiomas del sitio» (pestaña SEO del proyecto) declara los idiomas por **prefijo de ruta**
  (`/es`, `/en`…), no por país: el idioma por defecto usa `/` y las páginas fuera de todo prefijo declarado quedan en «Sin idioma». Un
  prefijo por idioma, códigos de 2 o 3 letras; la tarjeta sugiere los prefijos que ya aparecen en los datos descargados. Con idiomas
  declarados, la pantalla gana un selector (`?idioma=es`, `?idioma=none`; se conserva junto a `?periodo=`) que filtra todos los indicadores,
  gráficos y rankings, y una tabla «Por idioma» con clics, impresiones y sesiones de cada uno. Tabla `seo_markets` (migración `0014`),
  **entra en los respaldos**. Código: `domain/seo-markets.ts` (puro), `repositories/seo-markets.ts` (filtro SQL por prefijo) y
  `services/seo-markets.ts`.
- **Vista del cliente (fase 1c):** el portal del cliente (`/c/<cliente>/<proyecto>`, con su PIN) muestra la misma sección «Tráfico y
  búsqueda», solo de lectura y sin estados de descarga, errores ni botones: solo los datos y hasta qué día llegan. **Es opt-in por
  proyecto**: la tarjeta «Visible para el cliente» (pestaña SEO del proyecto) la activa o la oculta; por defecto está oculta. Columna
  `projects.seo_client_visible` (migración `0015`, entra en los respaldos). La única puerta del portal a estos datos es
  `services/seo-portal.ts` (`getPortalSeoDashboard`): devuelve null si el proyecto no es de ese cliente, no está en producción, está
  archivado, no fue activado o no tiene conexión a Search Console ni GA4; se comprueba en el servicio, no en la pantalla. El componente
  es el mismo para el administrador y el cliente (`app/_components/seo/`, con `audience`). Sus parámetros (`?periodo=`, `?idioma=`) son
  distintos de los de la evolución (`?dias=`), así que cada panel conserva lo que eligió en el otro.
- **Auditoría técnica (fase 2):** un rastreador propio del worker audita el sitio de un proyecto como lo haría un buscador y muestra
  una lista priorizada de problemas en la sección «Auditoría técnica» de la pestaña SEO (solo administradores; el portal del cliente
  no la muestra todavía). Se pide con «Rastrear ahora» (sirve también en proyectos en desarrollo, como lista de comprobación antes de
  entregar) y corre sola cada semana (domingos 04:23 UTC) en los proyectos en producción con Search Console o GA4 conectados.
  - **Qué hace:** lee `robots.txt` y los sitemaps, y recorre la portada, el sitemap y los enlaces internos hasta 3 niveles, **sin
    ejecutar JavaScript**. Solo hosts del proyecto, con las mismas protecciones anti-SSRF que Lighthouse. No usa credenciales: un
    sitio que pide sesión se informa como tal. Se identifica como `PageSpeedAOC-SEO/1.0` (es lo que un cliente permitiría en su
    cortafuegos), respeta `robots.txt` y `Crawl-delay`, y limita su ritmo (2 peticiones a la vez con pausa de 400 ms).
  - **Límites:** 300 páginas, 1 MB de HTML por página, 10 s por página, 20 minutos en total; pasado el tope termina como **parcial** y
    lo dice (y omite lo que necesita verlo todo: páginas huérfanas, idiomas sin páginas). Si un cortafuegos responde 403 o 429 de
    forma masiva, se corta y se explica; no se entregan páginas dudosas como errores.
  - **Hallazgos:** 40 tipos con gravedad (error, aviso, información), evidencia y «qué hacer»: acceso (errores, bucles y cadenas de
    redirecciones, enlaces rotos, huérfanas), indexación (`noindex`, `robots.txt` y sitemap), canónicas, contenido (`title`,
    `meta description`, `h1`), idiomas (`lang`, `hreflang` recíproco, `x-default`) y datos estructurados (JSON-LD). No hay puntuación
    global: se muestran conteos por gravedad y la variación frente al rastreo anterior (nuevos y resueltos). `?hallazgo=` abre el
    detalle de un tipo; `?idioma=` filtra por idioma, igual que «Tráfico y búsqueda».
  - **Datos:** `seo_crawl_runs`, `seo_crawl_pages` y `seo_crawl_issues` (migración `0016`, entran en los respaldos). Un solo rastreo
    activo por proyecto (índice único). Nunca se guarda el HTML ni el texto de las páginas, solo hechos técnicos. Se conservan las
    páginas y hallazgos de los últimos 12 rastreos; de los anteriores queda su fila con los conteos. La reconciliación del worker
    cierra los rastreos perdidos (sin trabajo en Redis) para no bloquear al proyecto.
  - **Código:** `domain/seo-crawl-parse.ts`, `seo-robots.ts`, `seo-crawl-rules.ts` y `seo-crawl-rows.ts` (puros), `seo/crawler.ts`,
    `repositories/seo-crawl.ts`, `services/seo-crawl.ts`, trabajo `seo-crawl` en `worker/start.ts` y
    `app/admin/seo/_components/crawl-section.tsx`. Dependencias nuevas: `htmlparser2` y `robots-parser`.
- **Despliegue:** el cambio toca `src/server` y la lista de respaldos del worker: despliega **primero el web** (aplica la migración)
  y **después el worker**.

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

La fuente de verdad del diseño es el Design System "PageSpeed" (Rajdhani, Midnight Navy y Electric Lime).
`design/tokens.json` es su espejo; no se editan valores en código. Para aplicar un cambio:

1. Cambia el valor en el Design System.
2. Copia su `tokens.json` a `design/tokens.json`.
3. `pnpm tokens:sync` regenera `src/lib/ui/tokens/*` (CI verifica que no haya diferencias).

## Quién ve qué (equipos internos)

- **El propietario ve todo.** Un miembro (rol `admin`) ve los clientes de los que es **responsable** (`clients.owner_id`: quien los crea, o a quien se
  los reasignan), los que le **compartieron enteros** (con todos sus proyectos, también los futuros) y los **proyectos sueltos** que le compartieron.
  Un cliente sin responsable o cuyo responsable salió del equipo es del propietario.
- **Compartir** lo hacen solo el propietario o el responsable, en la tarjeta «Compartir con el equipo» de la ficha del cliente (entero o por proyecto) o
  del proyecto (tabla `team_shares`, migración 0025). Quien recibe lo opera igual que el responsable **salvo** compartir, cambiar el responsable,
  archivar, restaurar, borrar y suspender. Con solo proyectos compartidos, la ficha del cliente es un contenedor: nombre y esos proyectos, sin PIN,
  contacto, correos ni responsable. Cada tarjeta de proyecto ajeno lleva la insignia «Compartido».
- **Dónde se aplica:** dominio puro `domain/access.ts` (alcance = el mismo `KeyAccess` de las claves de agente), servicios `access.ts` (guardas que
  responden 404, también cuando existe pero no se ve) y `team-access.ts`; listados filtrados en SQL con `repositories/scope.ts`; guardas
  `@/lib/auth/access` en **todas** las acciones de servidor, rutas `/api/admin/**` y fichas. `tests/unit/team-access-guard.test.ts` falla si se añade
  una acción, una ruta o un listado del panel sin guarda. Lo del sistema entero (cuenta de Google, respaldos, equipo, contadores de la cola) es del propietario.
- **Agentes (MCP):** cada clave guarda quién la creó (`mcp_api_keys.created_by`; nulo = propietario) y **nunca ve más que su creador**, ni siquiera si
  lo que él ve cambia después (se intersecta en cada llamada: `intersectAccess`). «Acceso total» en la clave de un miembro significa «todo lo que yo vea».
  Cada miembro lista y gestiona solo sus claves; el propietario, todas. Al quitar a alguien del equipo sus clientes pasan al propietario y sus claves se borran.
- **Efecto al desplegar la migración 0025:** los miembros dejan de ver los clientes que no crearon hasta que se los compartan. Conviene que el propietario
  comparta lo necesario ese mismo día.

## Equipo y acceso al panel

- La cuenta **propietaria** se crea al primer arranque con `ADMIN_EMAIL` / `ADMIN_PASSWORD` (solo se leen cuando no existe ninguna; cambiarlas después no agrega ni cambia a nadie).
- Las demás personas se **invitan por correo** desde **Panel → Equipo** (solo el propietario lo ve): reciben un enlace de un solo uso, válido 7 días, para crear su propia contraseña. Solo el propietario agrega o quita personas, reenvía invitaciones o envía un enlace de contraseña nueva. Qué ve cada persona lo decide el modelo de acceso de abajo. Si el correo no sale, el enlace se copia desde la pantalla.
- **La invitación por correo** lista por secciones numeradas todo lo que se puede hacer en la plataforma (clientes y proyectos, auditorías y alertas, SEO, lo que recibe el cliente, lo que anota cada responsable, agentes MCP, lo que está en camino y lo exclusivo de la cuenta propietaria) y pide completar nombre, apellido y WhatsApp en «Mi perfil», que es lo que ven los clientes. El listado vive en `STAFF_GUIDE` (`notify/invite-email.ts`): se actualiza ahí cuando cambia lo que hace el panel.
- Al invitar se prepara **el perfil completo** de la persona: nombre, apellido y foto (todo opcional) y cómo entra: **enlace por
  correo** (la cuenta nace con esos datos al aceptarlo) o **contraseña provisional** (la cuenta se crea en el acto, sin correo; la
  contraseña se muestra una sola vez y la persona puede cambiarla en su perfil, con un aviso mientras siga siendo provisional).
  La foto de una invitación se guarda en R2 bajo `_avatars/<id de la futura cuenta>/` y se borra si la invitación se revoca o se
  reemplaza, y al quitar a la persona. Migración 0011.
- Las invitaciones guardan solo el sha256 del token (`admin_invites`); el enlace `/invitacion/<token>` lleva `no-referrer`, `noindex` y `no-store`, y cada IP tiene un límite de intentos. Quitar a alguien o cambiar su contraseña cierra sus sesiones.

## Perfil y barra superior

- La barra superior lleva, a la derecha, el conmutador de proyectos, una **campana** de alertas (número de alertas abiertas
  y, al abrirla, las 5 más recientes con «Ver todas las alertas») y el **avatar** de la persona, que abre su menú: Mi perfil,
  Equipo (solo el propietario), Archivados y Salir. El menú es accesible (Esc, clic fuera, flechas, Inicio y Fin).
- **Mi perfil** (`/admin/perfil`, cualquier administrador): foto, nombre, apellido y WhatsApp (opcionales; firman los correos de sus clientes) y cambio de contraseña (pide
  la actual, mínimo 12 caracteres, con límite de intentos); al cambiarla se cierran las demás sesiones y la actual se renueva.
- La **foto** se recorta en cuadrado y se reduce a 256 px en el navegador, se valida en el servidor por firma (PNG, JPEG o
  WebP, máximo 1 MB) y se guarda en R2 bajo `_avatars/<id>/…`; solo se sirve con sesión de administrador
  (`/api/admin/avatar/<id>`). Reemplazarla o quitarla borra el objeto anterior. Migración 0010: `first_name`, `last_name`,
  `avatar_key` en `admin_users`.
- **Logotipos de cliente** (migración 0017: `logo_icon_key`, `logo_full_key`, `logo_bg`, `logo_updated_at` en `clients`). Dos
  versiones por cliente: **isotipo** (casi cuadrado) y **logotipo completo** (cualquier proporción), subidas desde la ficha del
  cliente. El navegador las convierte a PNG con transparencia (SVG, JPEG, WebP y GIF incluidos; sin recorte) y el servidor las
  vuelve a validar por firma, peso (512 KB) y medidas (`domain/client-logo.ts`). Viven en R2 bajo `_logos/<cliente>/…` y se
  sirven solo con sesión de administrador (`/api/admin/client-logo/<id>`) o, en el portal, con el PIN ya validado
  (`/c/<enlace>/logo?k=icon|full`; nunca en la pantalla del PIN). Color de fondo opcional por cliente para logotipos blancos.
- **Rutas del portal en árbol** (`/c/<enlace>/<proyecto>/rutas`): `domain/route-tree.ts` deriva la jerarquía de `routes.path`
  (la tabla es plana): «/» es «Inicio», una página puede ser a la vez ruta y padre, un padre que solo existe porque tiene hijas
  es un nodo **virtual** (con el promedio de lo que contiene) y las mejoras suben a los padres. Cada fila muestra el **título**
  de la página (no la ruta), un globito con las mejoras y la cinta R · S · A · B · IA; al abrirla salen LCP, CLS, TBT, agentes,
  el botón «Ver detalle de ingeniería» y las páginas que contiene. Título (`domain/page-title.ts`): **etiqueta del
  administrador** (ficha del proyecto → Rutas → «Nombre que verá el cliente») → título del último rastreo sin la marca del
  sitio (solo si la página respondió 200 sin redirección y no exige sesión) → último segmento de la ruta. Se abren solas las
  ramas con mejoras dentro (hasta 12 páginas); las enormes se abren a mano. Con 109 rutas la pestaña tarda ~0,8 s en producción.
- **Mejoras del portal** (`/c/<enlace>/<proyecto>/mejoras`): cada alerta abierta (rubro por debajo de la meta, por dispositivo) se
  muestra con las **causas concretas** que Lighthouse encontró en la última auditoría de esa página, en frases llanas
  (`domain/improvement-glossary.ts`, con respaldo al título de Lighthouse en español) y con su impacto («≈ 1,9 s», «3 elementos»).
  Las causas (`domain/improvements.ts`) se extraen **al terminar cada auditoría** y se guardan en `audit_logs.improvements`
  (migración 0018): el portal no abre el JSON de R2 en cada vista. Las auditorías anteriores a la migración se leen de R2 una
  sola vez (hasta 12 por petición) y quedan guardadas. Cada página lleva su botón «Ver detalle de ingeniería» (a la pestaña del
  rubro afectado).
- **Tráfico y búsqueda del portal** (`.../trafico?periodo=7|28|90&seccion=visitas|google|salud`): periodo, cuatro cifras con su
  variación (clics, impresiones, sesiones y visitas desde IA como «mínimo observado») y tres secciones con tarjetas que se abren:
  **Visitas** (canales, páginas con su título, países, asistentes de IA), **Google** (CTR, posición, clics, países, dispositivos,
  idiomas) y **Salud SEO**: el último rastreo técnico en frases llanas (`domain/seo-client-glossary.ts`), solo errores y avisos
  (la información no se muestra), agrupado por tema (acceso, indexación, direcciones principales, contenido, idiomas, datos
  estructurados), con nuevos y resueltos frente a la revisión anterior y las páginas afectadas. Mismo interruptor que antes
  («Visible para el cliente», `seo_client_visible`) y solo proyectos en producción; la salud SEO no exige tener Google conectado.
- **Informes en PDF: resumen e ingeniería** (`/c/<enlace>/<proyecto>/informes`, `.../informe?tipo=resumen|ingenieria&dias=7|30|90`).
  Dos documentos con el **logotipo del cliente y el de la aplicación**: el **resumen** (5 apartados, normalmente 2 a 4 páginas, en
  lenguaje claro) y el de **ingeniería** (portada con índice y 8 apartados: método, notas y métricas por página, rendimiento a fondo,
  fallos por rubro, navegación agéntica, salud SEO del sitio, evolución y glosario; detalla las **30 páginas más débiles**). Los
  apartados salen de **una sola lista** (`domain/report-outline.ts`) que usan la pestaña (con el índice desplegable), los títulos del
  PDF y sus **marcadores** (el panel de navegación del lector); una prueba comprueba que cada PDF trae exactamente esos apartados. Todo
  se lee de lo ya guardado (notas y métricas, mejoras por auditoría, salud SEO, logotipos): no se abre R2 por ruta salvo el relleno
  acotado de auditorías anteriores a la migración 0018. Tráfico y salud SEO solo entran si el cliente puede verlos en su portal.
  Generación en serie con caché de 2 minutos por proyecto, periodo y tipo; con 100 rutas el de ingeniería tarda ~3 s y añade ~130 MB.
  Un enlace antiguo (`.../informe` sin `tipo`) sigue entregando el resumen. El **correo** (botón «Enviar los dos informes» del panel)
  adjunta **ambos**: `resumen-…pdf` e `informe-ingenieria-…pdf`. Fuente de los PDF: Rajdhani, que no trae «•» ni «≈» (se usan «–» y «aprox.»).
- **Que el portal quepa en el teléfono.** Regla: ninguna rejilla sin `grid-cols-N` base (los prefijos `md:`/`xl:` no cuentan) ni
  título en una sola línea (`truncate`) dentro de una rejilla: una columna implícita `auto` no baja de la anchura mínima de su contenido y
  un título largo ensancha la página (Safari la encoge y las barras fijas dejan de verse ancladas). Los títulos envuelven en dos líneas
  (`line-clamp-2`), `.portal` lleva `overflow-x: clip` como red de seguridad y `tests/unit/portal-layout-guard.test.ts` falla si se
  reintroduce. Comprobación manual en un teléfono simulado de 320 a 412 px (con títulos de 60 caracteres):
  `PORTAL_CLIENT=… PORTAL_PROJECT=… PORTAL_PIN=… node scripts/portal-fit-audit.mjs`.
- **Todas las mediciones, en todas partes** (revisión integral). `domain/measurements.ts` es la lista única de lo que se mide
  (velocidad, mejoras, experiencia real, búsqueda en Google, visitas, de dónde llegan, IA, salud SEO) y la usan el Resumen del
  portal (micro-tarjetas de `app/c/_components/measurement-cards.tsx`, datos de `services/project-measurements.ts`, con la misma
  puerta que Tráfico), la pestaña Informes (cada apartado marca «Incluido», «Aún sin datos» o «No activado» según
  `sectionState` de `domain/report-outline.ts`), los dos PDF (el índice cubre cada medición: lo comprueba una prueba), los correos
  y la tarjeta del proyecto en el panel (línea «Visitas 28 d», calculada con dos consultas para toda la flota).
- **Fuentes completas** (migraciones 0022 y 0023: tablas `seo_source_daily` y `seo_query_daily`; se retira `seo_social_daily`).
  GA4 se pide **sin filtro** por fuente y grupo de canal y `domain/seo-sources.ts` clasifica cada fila **una sola vez** (buscadores,
  redes sociales por nombre, directo, otros sitios con su dominio, asistentes de IA, correo, anuncios, otros), así que el reparto
  suma el 100 % de las visitas. Search Console guarda además las 50 consultas con más clics de cada día. Las filas de
  `seo_social_daily` se **copian** a la tabla nueva (no se pierde nada) y la migración pone `synced_through = null` en GA4 y Search
  Console **una sola vez** para que la siguiente descarga traiga los últimos 90 días completos (hasta entonces el portal no muestra
  «visitas hasta el…» y los correos automáticos esperan). Se ve en Tráfico → Visitas («De dónde llegan», con redes por nombre,
  buscadores y dominios) y Tráfico → Google («Con qué buscan»). Es un **mínimo observado**: los mensajes privados y algunas apps
  llegan sin referido y GA4 los cuenta como «Directo o sin identificar» (la nota recomienda enlaces con UTM).
- **Cloudflare** (rastreadores de IA y bots): hay conexión pero todavía **no se descarga ni se guarda ningún dato**; queda fuera de esta
  revisión (primero hay que persistir, después mostrar).
- **App instalable del portal**: el manifiesto se pide con `crossorigin="use-credentials"` (así lleva el nombre del cliente) y
  se llama «Informes técnicos web - <cliente>»; el icono es el isotipo con el rayo de PageSpeed en una insignia
  (`/c/<enlace>/pwa-icon/<tamaño>`, con dirección firmada con HMAC porque el navegador lo pide sin cookies). Sin sesión de PIN, el
  manifiesto es genérico.

## Marca

El producto se llama **PageSpeed**. El logo (un rayo y un chevron lima separados por una ranura diagonal, dentro de un marco con cuatro marcas de esquina) vive en `design/brand/`: `logo-mark.svg` (marca completa sobre navy), `logo-glyph.svg` (solo el glifo, de 12 a 32 px), `logo-mono.svg` (`currentColor`), `logo-lockup.svg` / `logo-lockup-light.svg` (glifo + PAGESPEED en trazados de Rajdhani) y `logo-favicon.svg`. En código, la geometría y el copyright salen de `src/lib/brand.ts` y se dibujan con `BrandMark`, `BrandGlyph` y `BrandLockup` (`src/lib/ui/components/brand-mark.tsx`); el PDF y los correos usan los mismos datos.

Los PNG (`public/pwa/icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `src/app/apple-icon.png`, `public/brand/*.png`) y `src/app/favicon.ico` se generan desde esos SVG: abre cada SVG en Chromium (Playwright) al tamaño pedido y captura la pantalla (el icono de la app, `design/icons/app-icon.svg`, lleva la marca al 74 % para la zona segura de las máscaras).

## Licencia

© 2026 zipnegocios · Gustavo Amarista. Todos los derechos reservados (ver `LICENSE`).

## Capas

`app/**` y `mcp/**` → `server/services` → `server/repositories` → `server/db`. `server/**` y `worker/**` no importan `next/*` (regla ESLint).
