# Fase 0 · Piloto SEO y visibilidad en IA

Scripts de **solo lectura** para comprobar, con un cliente real, que Search Console, GA4 y Cloudflare entregan datos
suficientes y fiables antes de construir el módulo. No tocan `src/`, la base de datos ni el worker, y no se incluyen
en las imágenes de producción (igual que `scripts/dev-worker.ts`).

Contexto: [plan de la fase 0](https://claude.ai/artifact/9BRfYphbfS8qSxTRRrW3hF) y [diseño del módulo](https://claude.ai/artifact/NQd6fWUvqgM9uk5F4nTzb7).

## Reglas

- **Se ejecutan en tu máquina**, no en una sesión compartida: manejan la llave de una cuenta de servicio y datos de un cliente.
- **Nada de esto se sube**: la llave JSON va fuera del repo; `.env.spike` y `.spike/` están en `.gitignore`.
- Los datos reales del cliente no se pegan en conversaciones ni en issues. Para compartir un ejemplo, sustituye páginas y cifras.
- Sin dependencias nuevas: `jose` firma el JWT de la cuenta de servicio y `fetch` llama a las APIs.
- Al terminar el piloto, revoca la llave de la cuenta de servicio y el token de Cloudflare.

## Preparación

1. Crea (o reutiliza) un proyecto de Google Cloud y habilita **Search Console API** y **Google Analytics Data API**.
2. Crea una cuenta de servicio y su llave JSON. Guárdala fuera del repo.
3. Añade el correo de la cuenta de servicio como usuario en la propiedad de **GSC** y como **lector** en la de **GA4**.
4. (Opcional) Crea un token de **Cloudflare** de solo lectura con permiso de analíticas de la zona y anota el ID de zona.
5. `cp scripts/spike-seo/env.spike.example .env.spike` y completa los valores.

## Scripts

Se ejecutan con `pnpm exec tsx scripts/spike-seo/<script>.ts`. Cada uno deja sus resultados en `.spike/` (o en `SPIKE_OUT_DIR`).

| Script | Qué hace | Credenciales |
| --- | --- | --- |
| `00-check.ts` | Comprueba qué fuentes están configuradas y si responden. No descarga datos | las que haya |
| `10-gsc.ts` | Rendimiento por fecha, página, país y dispositivo; consultas; sitemaps; inspección de unas URLs (`--inspect 5`). Mide filas, llamadas, retraso y reparto por idioma | cuenta de servicio |
| `20-ga4.ts` | Sesiones y usuarios por fecha, página, país, idioma y fuente; sesiones desde asistentes de IA | cuenta de servicio |
| `30-cloudflare.ts` | Rastreadores de IA por día (`--days 7`), rutas más rastreadas y referidos. El día que falla indica el historial del plan | token de Cloudflare |
| `40-crawl.ts` | Rastreo mínimo desde el sitemap (`--pages 20 --pause 500`): título, canónica, `hreflang`, `lang`, JSON-LD | ninguna |
| `50-probe.ts` | Sondeo de IA con preguntas repetidas (`--provider mock\|anthropic\|openai\|gemini\|perplexity\|all`, `--repeats 3`). Cada llamada real cuesta dinero | clave de cada proveedor |
| `60-compare.ts` | Totales de GSC y GA4 para contrastar a mano con sus interfaces, y cobertura del cruce por página | ninguna (lee la salida) |

Orden sugerido: `00` → `10` → `20` → `60` → `30` → `40` → `50`.

## Qué no está hecho a propósito

- **Respuestas reales de los proveedores:** los adaptadores de `lib/providers/` se escribieron contra la documentación vigente
  (anthropic, openai, gemini, perplexity) y se probaron con respuestas simuladas, no con llamadas reales. La primera corrida
  real puede mostrar diferencias: revisa `probe-failures.json`. Conocidos: Gemini devuelve redirecciones de Google en lugar de
  la URL real (la cita se reconoce por el título, que trae el dominio) y Perplexity anuncia el fin de su endpoint Sonar actual.
- Tablas, cola `seo`, panel, API y MCP: son de las fases 1 a 4.

## Estructura

- `lib/config.ts`, `lib/run.ts`, `lib/out.ts`: variables de entorno, arranque común y archivos de salida.
- `lib/http.ts`: `fetch` con tiempo máximo, reintentos en 429 y 5xx, errores tipados y registro de llamadas (cuota y tiempos).
- `lib/google-auth.ts`: cuenta de servicio → JWT RS256 → token de acceso.
- `lib/gsc.ts`, `lib/ga4.ts`, `lib/cloudflare.ts`: un cliente por fuente.
- `lib/lang.ts`, `lib/urls.ts`, `lib/join.ts`: idioma por prefijo de ruta, normalización de URLs y cruce de GSC con GA4.
- `lib/crawl.ts`, `lib/probe.ts`, `lib/providers/`: extracción SEO mínima y sondeo de IA (menciones y citas; un adaptador por proveedor).
- Pruebas de las piezas puras y de los clientes (con `fetch` simulado): `tests/unit/spike-seo.test.ts`.
