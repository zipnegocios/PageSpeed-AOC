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
(ver `.env.example`; no usa SESSION_SECRET, ADMIN_* ni SMTP).

- Si no hay worker en línea, el botón **Auditar** se niega con un aviso (no deja filas bloqueadas).
- En local, para auditar sitios en `localhost` (el worker de producción los rechaza a propósito):
  `pnpm exec tsx scripts/dev-worker.ts`. Ese script no se incluye en la imagen.
- Prueba con Chromium y Lighthouse reales (opcional):
  `TEST_CHROME_PATH=/ruta/a/chrome pnpm exec vitest run --dangerouslyIgnoreUnhandledErrors tests/integration/lighthouse-real.test.ts`
- `pnpm worker:build` compila el worker y genera su `package.json` mínimo (`scripts/worker-manifest.mjs`).

## Design System

La fuente de verdad del diseño es el Design System "AOC PageSpeed" (Rajdhani, azules tecnológicos, rojos sutiles).
`design/tokens.json` es su espejo; no se editan valores en código. Para aplicar un cambio:

1. Cambia el valor en el Design System.
2. Copia su `tokens.json` a `design/tokens.json`.
3. `pnpm tokens:sync` regenera `src/lib/ui/tokens/*` (CI verifica que no haya diferencias).

## Capas

`app/**` y `mcp/**` → `server/services` → `server/repositories` → `server/db`. `server/**` y `worker/**` no importan `next/*` (regla ESLint).
