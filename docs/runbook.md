# Runbook de operación — PageSpeed

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
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | ✔ | — | Solo se leen si no existe la cuenta propietaria. No sirven para agregar personas: eso se hace en Panel → Equipo |
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

**Semanal**: revisar los últimos fallos de la cola (códigos repetidos suelen ser un sitio caído o un host mal permitido) y el espacio de Postgres. El lunes, mirar la pestaña SEO de los proyectos en producción: el rastreo técnico del domingo (04:23 UTC) debe figurar «Completo»; uno «Fallido» o «Parcial» trae su motivo (ver «El rastreo técnico…» en la sección 7).

**Trimestral**: probar una restauración (sección 5) en una base de pruebas. Un respaldo que nunca se restauró no es un respaldo.

## 4. Despliegues

1. Cada push a `main` redespliega el **web** solo. Aplica las migraciones antes de servir.
2. El **worker** se redespliega a mano cuando el cambio toca `src/worker`, `src/server`, dependencias o `docker/Dockerfile.worker`. Cada entrega indica si hace falta.
3. Si el cambio incluye migración, despliega primero el web (la aplica) y luego el worker.
4. Redesplegar el worker espera a que termine la auditoría en curso (apagado ordenado). No pierde la cola: está en Redis y Postgres.
5. La imagen del worker instala sus dependencias **con las versiones exactas de `pnpm-lock.yaml`** (también las indirectas), así que lo que corre en producción es lo que se probó y un proveedor que publique sus paquetes a medias no rompe el despliegue. Al actualizar dependencias, cambia el lockfile y vuelve a desplegar el worker.
6. **Marcha atrás**: en EasyPanel, vuelve a desplegar el commit anterior. Las migraciones solo añaden: un commit anterior sigue funcionando con el esquema nuevo. Si una migración fue destructiva, restaura un respaldo (sección 5).

## 5. Respaldos y restauración

### Qué hay
- Cada día a las 03:17 UTC el worker sube a R2 un archivo `_backups/postgres/AAAA/MM/pagespeed-<fecha>.ndjson.gz` con **todas** las tablas. Se conservan 30 días y siempre los 5 más recientes. Si falla, el panel lo muestra (Cola → Respaldos) y llega un correo.
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
   También acepta una clave concreta (`node restore-cli.cjs _backups/postgres/2026/11/pagespeed-....ndjson.gz`) o un archivo local (`--file`).
4. La restauración ocurre en una sola transacción: o entra completa o no entra. Se niega si la base ya tiene clientes, proyectos o auditorías.
5. Reinicia el web y el worker. El worker registra de nuevo los agendadores y encola lo pendiente (reconciliación).
6. Comprueba: iniciar sesión (la contraseña es la del momento del respaldo), abrir un cliente, un portal y el historial de un proyecto.

Lo que se pierde: cambios hechos entre el último respaldo y la caída (hasta 24 h), y los trabajos que estaban en Redis (se reconstruyen).

## 6. Secretos y accesos

| Qué | Cómo se cambia | Efecto |
|---|---|---|
| Contraseña del propietario | En la consola de Postgres: `delete from admin_users where role = 'owner';` y reinicia el web con `ADMIN_EMAIL` y `ADMIN_PASSWORD` nuevos | Se crea la cuenta propietaria al arrancar; las demás personas siguen. Quita la contraseña de las variables después |
| Agregar a una persona del equipo | Panel → Equipo → *Invitar a una persona* (solo el propietario): correo, nombre, apellido y foto opcionales, y *Enlace por correo* o *Contraseña provisional* | Con enlace: le llega un enlace de un solo uso (7 días); si el correo no sale, copia el enlace de la pantalla. Con contraseña provisional: la cuenta se crea ya y se le pasa la contraseña (se muestra una vez); aparece «Contraseña provisional» hasta que la cambie en su perfil |
| Contraseña olvidada de otra persona del equipo | Panel → Equipo → *Enviar enlace de contraseña nueva* | Crea una contraseña nueva y cierra sus sesiones anteriores |
| Foto de perfil de una persona | Panel → avatar → Mi perfil. Se guarda en R2 bajo `_avatars/<id>/` (no pongas reglas de caducidad a ese prefijo); solo la ven los administradores con sesión | Quitar la foto borra el objeto |
| Quitar a una persona del equipo | Panel → Equipo → *Quitar* | Deja de poder entrar y su sesión se cierra en su siguiente petición |
| `SESSION_SECRET` | Cambiar la variable y reiniciar el web | Cierra todas las sesiones |
| Link de un cliente filtrado | Ficha del cliente → *Generar link nuevo* | El anterior deja de funcionar al instante. También sirve *Suspender* |
| Clave de agente (MCP) filtrada | Panel → Agentes → *Rotar clave* (genera una nueva; la anterior deja de servir al instante) o *Revocar* | El agente queda sin acceso hasta que le pongas la nueva. Una clave revocada se puede *Eliminar definitivamente* de la lista |
| `AUTH_ENCRYPTION_KEY` | No se puede rotar sin más: las credenciales guardadas quedan ilegibles. Cambia la clave en web **y** worker, redespliega ambos y vuelve a introducir el acceso de cada proyecto (tarjeta *Acceso a páginas privadas*) | Mientras tanto esas rutas fallan con `AUTH_CONFIG` |
| Token de R2 / SMTP | Rotar en el proveedor y actualizar la variable en **web y worker**; redesplegar ambos | — |

### Rotar las contraseñas de Postgres y Redis

Úsalo si se filtraron (por ejemplo, un registro de despliegue pegado en un chat: EasyPanel pasa las variables como argumentos de construcción y las imprime en claro cuando un despliegue falla). Hazlo en **una sola ventana de mantenimiento** de 15 a 20 minutos, para redesplegar web y worker una vez. El panel se corta unos segundos y la cola se reconstruye sola (Postgres es la fuente de verdad).

**Antes**
1. Panel → *Cola* → *Respaldar ahora* y espera «Al día»: es tu red de seguridad.
2. Comprueba si el Redis lo usa **alguna otra aplicación** además de PageSpeed (su nombre en EasyPanel no es `page_speed_…`). Si es compartido, cambiar su contraseña corta también a las otras: o las actualizas todas en la misma ventana, o creas un Redis propio para PageSpeed y mueves solo `REDIS_URL`.
3. Comprueba que ni Postgres ni Redis tienen **puerto externo expuesto** (en su servicio, ajustes avanzados). Si lo tienen y no es necesario, quítalo.
4. Genera cada contraseña nueva **sin mostrarla** (solo letras y números, para que no rompan la URL) y guárdala en el gestor de contraseñas. En PowerShell queda en el portapapeles:
   `$b = New-Object byte[] 24; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ([Convert]::ToBase64String($b) -replace '[^A-Za-z0-9]','') | Set-Clipboard`
   Conserva las contraseñas **viejas** hasta el final: son tu marcha atrás.

**Postgres**
1. En la consola del servicio Postgres: `psql -U <usuario> -d <base>` y, dentro, `\password <usuario>` (pide la nueva dos veces, sin mostrarla). Cambiar solo la variable del servicio **no** cambia la contraseña de un rol que ya existe; hay que hacerlo con `\password` o `ALTER USER`.
2. Si el servicio de EasyPanel guarda la contraseña en sus credenciales, ponla también ahí para que no queden desalineadas.
3. Las conexiones ya abiertas siguen valiendo; las nuevas piden la contraseña nueva. Por eso el paso siguiente va justo después.

**Redis**
1. En el servicio Redis, cambia la contraseña en sus credenciales (el nombre del campo puede variar según la versión de EasyPanel) y **despliega Redis**. Se reinicia; la cola se reconstruye desde Postgres al arrancar el worker y cada 15 minutos.

**Después, en web y worker** (las dos variables, en los dos servicios)
1. `DATABASE_URL` = `postgres://<usuario>:<contraseña nueva>@<host interno>:5432/<base>?sslmode=disable`
2. `REDIS_URL` = `redis://default:<contraseña nueva>@<host interno>:6379`
3. Despliega el **worker** (manual) y el **web**.

**Verificación**
- Panel → *Estado del sistema*: Postgres y Redis en verde; *Cola*: worker en línea.
- Abre un portal de cliente y una auditoría; pulsa *Actualizar ahora* en una pestaña SEO.
- Logs del worker: sin «error de Redis» ni errores de autenticación de Postgres.
- Cualquier otra cosa que se conectara con la contraseña vieja (un cliente de base de datos en tu equipo, un `.env` local, otra aplicación) deja de funcionar: actualízala.

**Marcha atrás:** si algo falla, devuelve la contraseña vieja (`\password` en Postgres; credenciales de Redis + despliegue) y las dos variables a su valor anterior. Cuando todo esté en verde durante un rato, borra las viejas del gestor.

**Recuerda:** las contraseñas viejas siguen apareciendo en los registros de despliegues anteriores de EasyPanel; al estar rotadas ya no sirven. No pegues registros completos en chats o tickets: solo el tramo con el error.

## 7. Incidentes

**El panel dice "Worker fuera de línea"**
Mira los logs de `page_speed_worker`. Causas habituales: servicio detenido, `REDIS_URL` mal puesta, falta de memoria (límite < 1,5 GB). Al arrancar debe verse "worker listo". Las auditorías pedidas no se pierden: quedan en cola y corren al volver.

**Auditorías atascadas "En cola" o "En curso"**
El worker las reconcilia cada 15 minutos (las huérfanas vuelven a la cola o fallan). Si hace falta ya: redespliega el worker.

**Una ruta privada falla con `AUTH_FAILED`, `AUTH_NOT_CONFIGURED` o `AUTH_CONFIG`**
`AUTH_FAILED`: la contraseña de prueba cambió, las cookies caducaron o el formulario es poco común (revisa los selectores). Entra a mano con ese usuario para comprobarlo y vuelve a guardar el acceso. `AUTH_NOT_CONFIGURED`: la ruta pide sesión pero el proyecto no tiene acceso. `AUTH_CONFIG`: `AUTH_ENCRYPTION_KEY` del worker no coincide con la del web (o falta). No se reintentan; la alerta de fallo queda abierta hasta que se corrija.

**«Datos reales de usuarios» sin datos o con error**
Crea la clave en Google Cloud (console.cloud.google.com): selecciona o crea un proyecto → *APIs y servicios* → *Biblioteca* → activa «Chrome UX Report API» → *Credenciales* → *Crear credenciales* → *Clave de API*, y en *Restricciones de API* déjala solo para esa API. Cárgala como `CRUX_API_KEY` en el **worker**, redespliégalo y pulsa *Actualizar datos reales* en la ficha del proyecto. El botón actualiza solo ese proyecto (sea cual sea su fase; la ronda diaria únicamente recorre los de producción) y la tarjeta cuenta cómo salió. Si el panel dice «Falta definir CRUX_API_KEY», no llegó al worker; si sigue diciendo «Aún no hay datos reales» un minuto después de pulsar, el worker no está procesando la petición (¿sigue con la versión anterior?); si dice `BAD_KEY`, la clave no tiene permiso para esa API o su restricción de aplicación no permite la IP de salida del worker (compruébala con `node -e "fetch('https://api.ipify.org').then(r=>r.text()).then(console.log)"` en la consola del worker); `QUOTA`, se superó el límite (se reintenta al día siguiente). Un sitio o página con poco tráfico de Chrome muestra «no tiene suficiente tráfico»: es normal y no se arregla con la clave.

**La conexión a Search Console o GA4 figura «Conectado», pero la descarga dice «Falta la cuenta de servicio de Google en el worker»**
La prueba de conexión corre en el **web** y la descarga en el **worker**, y no comparten variables. Define `GOOGLE_SERVICE_ACCOUNT_JSON` también en el servicio del worker (el JSON completo, en una sola línea) y redespliégalo; después pulsa *Actualizar ahora*. Si la cuenta se guardó desde SEO → Cuenta de Google en lugar de la variable, el worker necesita la misma `AUTH_ENCRYPTION_KEY` que el web.

**El rastreo técnico (pestaña SEO → «Auditoría técnica») sale «Fallido» o «Parcial»**
El motivo está escrito en la propia pantalla. Los casos:
- *«El sitio rechaza al rastreador (403 o 429)»* o *«un cortafuegos está frenando al rastreador»*: el sitio (casi siempre Cloudflare u otro WAF) bloquea al agente `PageSpeedAOC-SEO/1.0`. No hay nada que arreglar aquí: hay que pedir al cliente que lo permita (ver «Pedir a un cliente que permita el rastreador» abajo). No se guardan hallazgos de un rastreo bloqueado, para no llenar el panel de falsos errores.
- *«El sitio pide iniciar sesión (401)»*: típico de un sitio en desarrollo protegido con contraseña. El rastreo no usa credenciales y no intenta saltarse la protección. Opciones: auditarlo cuando se publique, o pedir al cliente que habilite una excepción por IP del worker para el entorno de pruebas.
- *«La portada del sitio no responde»*: el sitio está caído o el host no resuelve. Comprueba la dirección base del proyecto y avisa al cliente.
- *«La dirección del proyecto no está entre sus hosts permitidos»*: arregla *Hosts permitidos* en el proyecto (el rastreo, como Lighthouse, solo toca esos hosts).
- *«robots.txt prohíbe rastrear todo el sitio»*: el sitio tiene `Disallow: /`. Es lo habitual en un sitio en desarrollo; si no es lo que se quiere, el cliente debe corregir su `robots.txt`.
- *«Se alcanzó el máximo de 300 páginas»* o *«el tiempo máximo»* (**parcial**): no es un fallo. Los resultados valen, pero no se evalúan las comprobaciones que necesitan ver todo el sitio (huérfanas, idiomas sin páginas). Si el sitio es más grande, los límites son constantes de `server/seo/crawler.ts` (`DEFAULT_LIMITS`; el tope duro es 1.000 páginas).
- *«El rastreo se perdió (el worker se detuvo o Redis perdió el trabajo)»*: lo cierra la reconciliación (cada 15 minutos) cuando un rastreo lleva 45 minutos en curso, o 5 en cola, sin trabajo vivo en Redis. Vuelve a pedirlo con «Rastrear ahora».
- *«El rastreo falló por un error inesperado»*: mira los logs de `page_speed_worker` (línea `[seo] rastreo`). El rastreo no se reintenta solo.
Si un proyecto parece bloqueado con un rastreo «En cola» o «En curso» que no avanza, espera a la reconciliación o redespliega el worker; no hay que tocar la base de datos.

**Pedir a un cliente que permita el rastreador**
El rastreo se identifica con el agente de usuario `PageSpeedAOC-SEO/1.0` y sale por la misma IP que el worker (averíguala con `node -e "fetch('https://api.ipify.org').then(r=>r.text()).then(console.log)"` en la consola del worker). El agente de usuario se puede falsificar, así que lo ideal es permitir **el agente y la IP a la vez**. En Cloudflare, según el plan: una regla personalizada en *Seguridad → WAF* con «User Agent contiene `PageSpeedAOC-SEO` **y** IP de origen es `<IP del worker>`» y acción *Omitir* (o *Permitir*) las protecciones; si solo tiene *Bot Fight Mode* en el plan gratuito, que no se puede omitir con reglas, queda la lista de acceso por IP (*Seguridad → WAF → Herramientas → Reglas de acceso por IP*). Otros WAF o plugins de seguridad de WordPress tienen listas equivalentes de agentes o IP permitidas. Mensaje para el cliente:
> Estamos auditando el SEO técnico de tu sitio (enlaces rotos, idiomas, datos estructurados) con un rastreador que se identifica como «PageSpeedAOC-SEO/1.0» y respeta tu robots.txt. Va despacio (2 peticiones a la vez) y solo lee páginas públicas. Tu cortafuegos lo está bloqueando; ¿puedes permitir ese agente de usuario desde la IP `<IP>`?

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
3. Pulsa *Primer escaneo de todas las rutas* en cada proyecto (tarjeta *Rutas*; son ~30 auditorías en total; si la cola no admite más de 50 a la vez, repite el botón cuando avance). Verifica en **Cola** que corren de una en una (nunca dos *En curso*) y que la pausa entre ellas se respeta.
4. Durante la ráfaga mide: pico de memoria del worker (< 2 GB), CPU total del VPS y tiempos de los sitios vecinos. Criterio: ningún vecino supera 2× su tiempo habitual de forma sostenida.
5. Deja la semana corriendo. Revisa al final: fallos por código, respaldos diarios presentes en R2, alertas coherentes, correos recibidos.
6. Prueba una restauración del último respaldo en una base de pruebas (sección 5).

## 8 bis. Prueba de aceptación del rastreo técnico con un sitio real (criterio de salida de la fase 2)

El rastreo solo se puede dar por bueno con un sitio real: los fallos que importan (WAF, HTML raro, idiomas mal declarados) no salen en los sitios de prueba. Elige un proyecto en producción con idiomas (por ejemplo el que ya tiene Search Console y GA4).

1. Despliega el web (migración `0016`) y después el worker. Comprueba en los logs del worker: «worker listo» y que no hay errores al registrar «la ronda semanal de rastreo técnico».
2. En el proyecto: pestaña SEO → declara sus idiomas (*Idiomas del sitio*) → *Rastrear ahora*. Debe terminar en pocos minutos (≈ 4 a 6 para 300 páginas). Anota las páginas revisadas y el estado.
3. **Muestra de 10 páginas**: elige 10 (la portada, una de cada idioma, una con formulario, una del blog, una que sepas rota, una con `noindex`, una redirigida) y compara con una herramienta externa (Screaming Frog en su versión gratuita, hasta 500 URL, o «Ver código fuente» y Search Console) estos campos: estado, `title`, `meta description`, número de `h1`, canónica, `lang`, `hreflang` y datos estructurados. En cada campo, lo que muestra el panel debe coincidir. Anota cualquier diferencia y su causa.
4. **Comparable con Screaming Frog**: enlaces internos rotos, redirecciones en cadena, títulos y descripciones duplicados o ausentes, y `hreflang` sin reciprocidad deben coincidir en cantidad (hasta el tope de páginas del rastreo). Las diferencias esperables: el panel agrupa por página y no cuenta recursos (imágenes, CSS, JS), y solo rastrea hasta 3 niveles.
5. **Repetir no duplica ni pierde**: pulsa *Rastrear ahora* otra vez sin cambiar nada: debe dar los mismos totales, con «0 nuevos y 0 resueltos».
6. **Un cambio se refleja**: corrige uno de los hallazgos en el sitio (por ejemplo, un título) y vuelve a rastrear: debe aparecer como «1 resuelto».
7. **Cortesía**: en los logs del sitio (si el cliente los comparte) el agente `PageSpeedAOC-SEO/1.0` pide como mucho 2 páginas a la vez, y no toca lo que `robots.txt` prohíbe.
8. **Falsos positivos**: revisa a ojo 5 hallazgos de cada gravedad. Si más de uno de cada cinco es falso, no se da por aceptado: anota qué regla falla (el código del hallazgo) y se ajusta antes de mostrar nada al cliente.

Criterio de salida: el rastreo termina dentro de sus límites, la muestra coincide, repetirlo no cambia nada y los falsos positivos son escasos. Mientras no se cumpla, la auditoría sigue siendo solo para administradores (el portal no la muestra).

## 9. Lista de puesta en marcha

- [ ] Variables de la sección 1 en web y worker; `APP_URL` con `https://`.
- [ ] Para conectar claude.ai: `APP_URL` igual a la URL pública exacta (p. ej. `https://pagespeed.zipnegocios.com`) y el proxy debe dejar pasar `/.well-known/*` y `/oauth/*` sin pedir otra autenticación. Prueba: `curl https://<dominio>/.well-known/oauth-protected-resource` devuelve JSON con `resource`.
- [ ] Redis con `noeviction` y AOF.
- [ ] Token de R2 acotado al bucket; versionado del bucket activado.
- [ ] Panel → *Estado del sistema* todo en verde.
- [ ] Primer respaldo hecho (*Respaldar ahora*) y `restore-cli.cjs latest --dry-run` válido.
- [ ] Una auditoría real por cliente y un portal abierto desde un móvil.
- [ ] Correo de alerta de prueba recibido (umbral alto en un proyecto en producción).
- [ ] Rama `main` como predeterminada en GitHub; webhook de `redis` eliminado.
- [ ] Rastreo técnico: prueba de aceptación de la sección 8 bis hecha en un proyecto real; los clientes con WAF permiten el agente `PageSpeedAOC-SEO`.

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
