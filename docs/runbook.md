# Runbook de operación — AOC PageSpeed

Para quien opera el sistema en EasyPanel. Cada sección es independiente: ve directo a lo que necesitas.

## 1. Piezas

| Servicio | Qué hace | Despliegue | Réplicas |
|---|---|---|---|
| `page_speed` (web) | Panel, portal del cliente, MCP, PDF, migraciones al arrancar | Automático con cada push a `main` (webhook) | 1 |
| `page_speed_worker` | Auditorías con Chromium, alertas por correo, respaldos | **Manual** (botón Deploy) | **1, nunca más** |
| Postgres | Índice de auditorías, clientes, configuración | — | 1 |
| Redis | Cola (BullMQ). Transitorio: la fuente de verdad es Postgres | — | 1 |
| Cloudflare R2 (`reportes`) | JSON de cada auditoría y respaldos (`_backups/`) | — | — |

Postgres es la fuente de verdad. Si Redis se pierde, el worker reconstruye la cola desde Postgres (al arrancar y cada 15 minutos).

### Variables por servicio

| Variable | Web | Worker | Notas |
|---|:-:|:-:|---|
| `DATABASE_URL`, `REDIS_URL` | ✔ | ✔ | Conexión interna de EasyPanel |
| `R2_ENDPOINT`, `R2_REGION`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | ✔ | ✔ | Token de R2 con lectura y escritura sobre el bucket |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | ✔ | ✔ | El web envía el informe; el worker, alertas y avisos de respaldo |
| `APP_URL` | ✔ | ✔ | Dirección pública con `https://`. Sin ella los enlaces de los correos apuntan a localhost |
| `ALERT_EMAIL` | opc. | opc. | Destinatario de alertas. Vacío: el correo del administrador |
| `AUTH_ENCRYPTION_KEY` | ✔ | ✔ | `openssl rand -base64 32`. **Idéntica en ambos.** Cifra las credenciales de páginas privadas. Guárdala fuera del sistema (gestor de contraseñas) |
| `SESSION_SECRET` | ✔ | — | ≥ 32 caracteres. Cambiarla cierra todas las sesiones |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | ✔ | — | Solo se leen si no existe ningún administrador |
| `AUDIT_COOLDOWN_MS`, `AUDIT_TIMEOUT_MS`, `AUDIT_ATTEMPTS` | — | opc. | 12000 / 90000 / 3 por defecto |
| `LOG_LEVEL` | opc. | opc. | `info` por defecto |
| `NODE_OPTIONS` | opc. | opc. | Las imágenes ya fijan `--max-old-space-size` (web 512, worker 512) |
| `CRUX_API_KEY` | — | opc. | Clave de la API «Chrome UX Report API» (datos reales de usuarios). Solo el worker. Ver abajo |
| `CHROME_PATH` | — | **no declarar** | La imagen del worker ya lo fija |

## 2. Recursos recomendados (VPS compartido)

- **Worker**: límite de memoria **2 GB**, 1,5 CPU. Chromium es el consumidor (≈ 400-900 MB por auditoría). Una sola réplica y una sola auditoría a la vez: es la defensa principal de los sitios vecinos.
- **Web**: 512 MB. El PDF se genera de uno en uno y se reutiliza 2 minutos.
- **Redis**: 128 MB bastan (`maxmemory-policy noeviction`, AOF activado). Con `noeviction`, si se llena, falla en lugar de borrar trabajos.
- **Capacidad de referencia**: 15 proyectos × 5 rutas × 2 perfiles ≈ 150 auditorías/día × (~30 s + 12 s de pausa) ≈ 1 h de cola al día en el peor caso diario.
- Si un sitio de un cliente se resiente durante una auditoría: sube `AUDIT_COOLDOWN_MS`, pasa ese proyecto a frecuencia semanal o, en el peor caso, desactiva el monitoreo de sus rutas más pesadas.

## 3. Rutina

**Diaria (1 minuto)**: Panel → *Estado del sistema* en verde; **Cola**: worker en línea, sin fallos nuevos, **Respaldos "Al día"**; **Alertas**: lo abierto tiene dueño.

**Semanal**: revisar los últimos fallos de la cola (códigos repetidos suelen ser un sitio caído o un host mal permitido) y el espacio de Postgres.

**Trimestral**: probar una restauración (sección 5) en una base de pruebas. Un respaldo que nunca se restauró no es un respaldo.

## 4. Despliegues

1. Cada push a `main` redespliega el **web** solo. Aplica las migraciones antes de servir.
2. El **worker** se redespliega a mano cuando el cambio toca `src/worker`, `src/server`, dependencias o `docker/Dockerfile.worker`. Cada entrega indica si hace falta.
3. Si el cambio incluye migración, despliega primero el web (la aplica) y luego el worker.
4. Redesplegar el worker espera a que termine la auditoría en curso (apagado ordenado). No pierde la cola: está en Redis y Postgres.
5. **Marcha atrás**: en EasyPanel, vuelve a desplegar el commit anterior. Las migraciones solo añaden: un commit anterior sigue funcionando con el esquema nuevo. Si una migración fue destructiva, restaura un respaldo (sección 5).

## 5. Respaldos y restauración

### Qué hay
- Cada día a las 03:17 UTC el worker sube a R2 un archivo `_backups/postgres/AAAA/MM/aoc-<fecha>.ndjson.gz` con **todas** las tablas. Se conservan 30 días y siempre los 5 más recientes. Si falla, el panel lo muestra (Cola → Respaldos) y llega un correo.
- *Respaldar ahora*: botón en Cola → Respaldos (lo ejecuta el worker; hay que tenerlo en línea).
- Las credenciales de páginas privadas van en el respaldo **cifradas**; la clave (`AUTH_ENCRYPTION_KEY`) no. Al restaurar en otro servidor, usa la misma clave o tendrás que volver a introducir los accesos.
- Los JSON de las auditorías ya viven en R2 y no forman parte del respaldo: allí están a salvo. **Recomendado**: activar el versionado de objetos del bucket en Cloudflare.
- El respaldo contiene hashes de contraseña, links mágicos y huellas de claves. Quien lea el bucket los ve: mantén el token de R2 acotado a ese bucket y no lo compartas.

### Restaurar (base perdida o dañada)
1. Crea un Postgres nuevo (o vacía el actual) y apunta `DATABASE_URL` del web y del worker a él.
2. Despliega el web: al arrancar aplica las migraciones (crea las tablas vacías). Si no hay `ADMIN_EMAIL` y `ADMIN_PASSWORD` puede quejarse de que no hay administrador: es normal, el respaldo lo trae.
3. En EasyPanel, abre la **consola del servicio web** y ejecuta:
   ```bash
   node restore-cli.cjs --list              # respaldos disponibles, el más reciente arriba
   node restore-cli.cjs latest --dry-run    # valida el último sin tocar nada
   node restore-cli.cjs latest              # restaura
   ```
   También acepta una clave concreta (`node restore-cli.cjs _backups/postgres/2026/11/aoc-....ndjson.gz`) o un archivo local (`--file`).
4. La restauración ocurre en una sola transacción: o entra completa o no entra. Se niega si la base ya tiene clientes, proyectos o auditorías.
5. Reinicia el web y el worker. El worker registra de nuevo los agendadores y encola lo pendiente (reconciliación).
6. Comprueba: iniciar sesión (la contraseña es la del momento del respaldo), abrir un cliente, un portal y el historial de un proyecto.

Lo que se pierde: cambios hechos entre el último respaldo y la caída (hasta 24 h), y los trabajos que estaban en Redis (se reconstruyen).

## 6. Secretos y accesos

| Qué | Cómo se cambia | Efecto |
|---|---|---|
| Contraseña del administrador | En la consola de Postgres: `delete from admin_users;` y reinicia el web con `ADMIN_EMAIL` y `ADMIN_PASSWORD` nuevos | Se crea el administrador al arrancar. Quita la contraseña de las variables después |
| `SESSION_SECRET` | Cambiar la variable y reiniciar el web | Cierra todas las sesiones |
| Link de un cliente filtrado | Ficha del cliente → *Generar link nuevo* | El anterior deja de funcionar al instante. También sirve *Suspender* |
| Clave de agente (MCP) filtrada | Panel → Agentes → *Revocar* | Deja de funcionar al instante |
| `AUTH_ENCRYPTION_KEY` | No se puede rotar sin más: las credenciales guardadas quedan ilegibles. Cambia la clave en web **y** worker, redespliega ambos y vuelve a introducir el acceso de cada proyecto (tarjeta *Acceso a páginas privadas*) | Mientras tanto esas rutas fallan con `AUTH_CONFIG` |
| Token de R2 / SMTP | Rotar en el proveedor y actualizar la variable en **web y worker**; redesplegar ambos | — |

## 7. Incidentes

**El panel dice "Worker fuera de línea"**
Mira los logs de `page_speed_worker`. Causas habituales: servicio detenido, `REDIS_URL` mal puesta, falta de memoria (límite < 1,5 GB). Al arrancar debe verse "worker listo". Las auditorías pedidas no se pierden: quedan en cola y corren al volver.

**Auditorías atascadas "En cola" o "En curso"**
El worker las reconcilia cada 15 minutos (las huérfanas vuelven a la cola o fallan). Si hace falta ya: redespliega el worker.

**Una ruta privada falla con `AUTH_FAILED`, `AUTH_NOT_CONFIGURED` o `AUTH_CONFIG`**
`AUTH_FAILED`: la contraseña de prueba cambió, las cookies caducaron o el formulario es poco común (revisa los selectores). Entra a mano con ese usuario para comprobarlo y vuelve a guardar el acceso. `AUTH_NOT_CONFIGURED`: la ruta pide sesión pero el proyecto no tiene acceso. `AUTH_CONFIG`: `AUTH_ENCRYPTION_KEY` del worker no coincide con la del web (o falta). No se reintentan; la alerta de fallo queda abierta hasta que se corrija.

**«Datos reales de usuarios» sin datos o con error**
Crea la clave en Google Cloud (console.cloud.google.com): selecciona o crea un proyecto → *APIs y servicios* → *Biblioteca* → activa «Chrome UX Report API» → *Credenciales* → *Crear credenciales* → *Clave de API*, y en *Restricciones de API* déjala solo para esa API. Cárgala como `CRUX_API_KEY` en el **worker**, redespliégalo y pulsa *Actualizar datos reales* en la ficha del proyecto. El botón actualiza solo ese proyecto (sea cual sea su fase; la ronda diaria únicamente recorre los de producción) y la tarjeta cuenta cómo salió. Si el panel dice «Falta definir CRUX_API_KEY», no llegó al worker; si sigue diciendo «Aún no hay datos reales» un minuto después de pulsar, el worker no está procesando la petición (¿sigue con la versión anterior?); si dice `BAD_KEY`, la clave no tiene permiso para esa API o su restricción de aplicación no permite la IP de salida del worker (compruébala con `node -e "fetch('https://api.ipify.org').then(r=>r.text()).then(console.log)"` en la consola del worker); `QUOTA`, se superó el límite (se reintenta al día siguiente). Un sitio o página con poco tráfico de Chrome muestra «no tiene suficiente tráfico»: es normal y no se arregla con la clave.

**Muchas auditorías fallan con el mismo código**
`TIMEOUT`/`PAGE_HUNG`: el sitio es lento o pesado; sube `AUDIT_TIMEOUT_MS` con cuidado. `SITE_DOWN`/`HTTP_5XX`: el sitio del cliente está caído (avísale). `FORBIDDEN_HOST`: el host salió de *Hosts permitidos* del proyecto. `CHROME_CRASH`: poca memoria en el worker.

**Redis perdido o vaciado**
No hay pérdida de datos. Al reiniciar el worker se reconstruyen colas y agendadores desde Postgres. Si el web dice "worker no está en línea" justo después, espera 30 segundos.

**R2 caído o con credenciales inválidas**
Las auditorías fallan al guardar y se reintentan. Revisa el token y `R2_*`. El panel de salud muestra R2 en rojo.

**Los correos no llegan**
Panel → Alertas → *Correos enviados* muestra el error de cada envío. Revisa `SMTP_*` en el **worker** (alertas) y en el **web** (informes). Los envíos fallidos se reintentan cada hora.

**Postgres caído**
El web responde 503 en `/api/health` y las pantallas fallan; el contenedor del web **no** se reinicia solo por esto. Recupera Postgres; si los datos se perdieron, sección 5.

**Un cliente reporta que su sitio va lento a la hora de las auditorías**
Mira la hora de sus auditorías en el historial. Opciones: frecuencia semanal, menos rutas monitoreadas, más `AUDIT_COOLDOWN_MS`. Las auditorías son de una en una, así que el impacto es una sola carga de página con Chromium.

## 8. Prueba de aceptación en el VPS real (criterio de salida de M6)

Una semana en producción sin degradar los sitios alojados.

1. Antes: anota CPU y memoria en reposo (`docker stats`) y el tiempo de respuesta de 2-3 sitios vecinos (por ejemplo con `curl -w "%{time_total}"` cada 5 minutos).
2. Pasa 3 proyectos reales a **producción** con 3-5 rutas monitoreadas cada uno.
3. Lanza *Auditar (móvil y escritorio)* en todas las rutas a la vez: son ~30 auditorías. Verifica en **Cola** que corren de una en una (nunca dos *En curso*) y que la pausa entre ellas se respeta.
4. Durante la ráfaga mide: pico de memoria del worker (< 2 GB), CPU total del VPS y tiempos de los sitios vecinos. Criterio: ningún vecino supera 2× su tiempo habitual de forma sostenida.
5. Deja la semana corriendo. Revisa al final: fallos por código, respaldos diarios presentes en R2, alertas coherentes, correos recibidos.
6. Prueba una restauración del último respaldo en una base de pruebas (sección 5).

## 9. Lista de puesta en marcha

- [ ] Variables de la sección 1 en web y worker; `APP_URL` con `https://`.
- [ ] Redis con `noeviction` y AOF.
- [ ] Token de R2 acotado al bucket; versionado del bucket activado.
- [ ] Panel → *Estado del sistema* todo en verde.
- [ ] Primer respaldo hecho (*Respaldar ahora*) y `restore-cli.cjs latest --dry-run` válido.
- [ ] Una auditoría real por cliente y un portal abierto desde un móvil.
- [ ] Correo de alerta de prueba recibido (umbral alto en un proyecto en producción).
- [ ] Rama `main` como predeterminada en GitHub; webhook de `redis` eliminado.

## Archivar y eliminar clientes y proyectos
- **Archivar** (ficha del cliente o del proyecto) lo oculta y detiene sus auditorías; no borra nada. Se ve y se restaura desde *Archivados* (menú superior).
- **Eliminar definitivamente** solo está en *Archivados*, exige escribir el nombre exacto y no se puede deshacer: borra la fila con todo lo que cuelga de ella y los informes de R2. Si R2 no responde, no se elimina nada y el mensaje lo explica.
- Si te equivocaste, los respaldos diarios de Postgres (ver «Respaldos») guardan copias de las filas durante 30 días; los informes de R2 borrados solo se recuperan con el versionado del bucket.

## Acceso de los clientes (PIN)
- Cada cliente entra por `/c/<identificador>` con un PIN de 6 dígitos. Sin PIN configurado nadie entra; se estrena con «Generar PIN» en la ficha del cliente o dejando que el propio cliente lo pida (le llega al correo de contacto).
- Para el correo, el servicio **web** necesita `SMTP_*` y `EMAIL_FROM` (los mismos de los informes por correo). Sin SMTP, «Generar PIN» sigue funcionando y se lo entregas tú.
- Si un cliente dice que «no le entra»: genera un PIN nuevo (anula el anterior y cierra sus sesiones) y compruébalo con él. Si ve «Demasiados intentos», espera 15 minutos o reinicia el servicio web (el contador está en memoria).
- Tras desplegar esta versión, los clientes existentes no tienen PIN: genera uno por cliente (o pídeles que usen «Enviar un PIN nuevo a mi correo») y avísales.
- La ficha del cliente muestra siempre el último PIN generado. Eso requiere `AUTH_ENCRYPTION_KEY` en el web; si falta (o cambia), el PIN sigue funcionando pero la ficha dice «No disponible» y basta generar uno nuevo. Los clientes que ya tenían PIN antes de esta función también muestran «No disponible» hasta generar el siguiente.
