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
- Pendiente (M4b): PDF bajo demanda, envío por email y PWA.

## Design System

La fuente de verdad del diseño es el Design System "AOC PageSpeed" (Rajdhani, azules tecnológicos, rojos sutiles).
`design/tokens.json` es su espejo; no se editan valores en código. Para aplicar un cambio:

1. Cambia el valor en el Design System.
2. Copia su `tokens.json` a `design/tokens.json`.
3. `pnpm tokens:sync` regenera `src/lib/ui/tokens/*` (CI verifica que no haya diferencias).

## Capas

`app/**` y `mcp/**` → `server/services` → `server/repositories` → `server/db`. `server/**` y `worker/**` no importan `next/*` (regla ESLint).
