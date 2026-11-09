# Guía para agentes: PageSpeed por MCP

Esta guía es para el agente de IA (o la persona que lo configura). Explica qué puede hacer, qué no, y cómo usar bien las herramientas sin cargar de más el servidor.

## Qué es PageSpeed

Audita con Lighthouse las páginas de los sitios de los clientes y guarda el historial. Cada **proyecto** pertenece a un **cliente** y tiene **rutas** (páginas). Cada auditoría se hace en un **perfil**: `mobile` o `desktop`.

- **Fase `development`**: se audita bajo demanda, con uno o ambos perfiles por página. No hay auditorías programadas ni alertas.
- **Fase `production`**: las rutas *monitoreadas* se auditan solas (semanal o diaria, móvil y escritorio). Si una puntuación baja de su umbral se abre una alerta y se avisa al administrador por correo.

Puntuaciones de 0 a 100: **90-100 bueno**, **50-89 mejorable**, **0-49 deficiente**. LCP y TBT en milisegundos; CLS sin unidad. Lighthouse en laboratorio no mide INP: usa TBT.

## Conexión

- **Desde claude.ai (web):** Personalización → Conectores → *Añadir conector personalizado* → nombre «PageSpeed» y la dirección del MCP → Continuar. Se abre la pantalla de PageSpeed (inicia sesión si hace falta): la persona administradora elige permisos y alcance y pulsa *Autorizar*. No hay clave que copiar.

- Dirección: `https://<tu-dominio>/api/mcp` (HTTP, sin sesión: cada petición es independiente).
- Autenticación: `Authorization: Bearer pagespeed_...`. Las claves las crea la persona administradora en **Panel → Agentes**; se ven una sola vez.
- Claude Code: `claude mcp add --transport http pagespeed https://<tu-dominio>/api/mcp --header "Authorization: Bearer TU_CLAVE"`
- Los navegadores ajenos (cabecera `Origin` distinta) se rechazan; el cliente MCP de un agente no la envía.

## Qué herramientas tienes

Tu clave solo ve las herramientas de su nivel. Si una no aparece en `tools/list`, no tienes permiso: no la intentes por otro camino.

**Tu clave también tiene un alcance de datos**: puede llegar a todos los clientes y proyectos, o solo a los clientes (con todos sus proyectos, también los futuros) y proyectos que la persona administradora eligió al crearla. `list_projects` solo devuelve los tuyos; cualquier otro proyecto, ruta o auditoría responde «no encontrado», igual que si no existiera. No intentes adivinar identificadores ajenos: no los vas a ver, y no es un error tuyo.

| Nivel | Herramientas |
|---|---|
| **Solo lectura** | `list_projects`, `get_project`, `list_routes`, `get_audit_history`, `get_audit`, `get_audit_status`, `get_thresholds` |
| **+ auditorías** | `run_audit`, `discover_routes` |
| **+ configuración** | `set_thresholds`, `add_route`, `set_route_monitored` |

**Nunca** se puede, por diseño: borrar o archivar clientes, proyectos o rutas; cambiar la fase; rotar el link de un cliente; suspender o reactivar clientes; crear claves. Si te lo piden, explica que eso lo hace la persona administradora desde el panel.

## Cómo trabajar bien

1. **Empieza por `list_projects`** para obtener los `project_id`; después `get_project` da rutas, umbrales, alertas abiertas y la última puntuación de cada ruta y perfil con su variación. Casi siempre basta con eso para responder «¿cómo va X?».
2. **Para explicar una puntuación, usa `get_audit` con `include_details: true`**: devuelve las comprobaciones de Lighthouse que fallan por categoría (con su porqué y enlace) y las mejoras con más ahorro. Es más barato que adivinar.
3. **Para tendencias, `get_audit_history`** (más reciente primero). Pide solo el periodo y el límite que necesites; no traigas un año entero si basta un mes.
4. **Lanzar una auditoría es costoso**: corre en un servidor compartido con los sitios de los clientes, de una en una y con pausa entre cada una. Hazlo solo cuando la persona lo pida o cuando falte un dato imprescindible.
   - Usa `profile` para auditar un solo perfil cuando no necesites los dos; sin él se auditan móvil y escritorio, también en desarrollo.
   - Si ya hay una auditoría pendiente de esa ruta y perfil, `run_audit` te devuelve esa: no se duplica.
   - Con `wait_seconds` (máx. 45) esperas el resultado; si no llega, la respuesta lo dice. **No repitas `run_audit`**: consulta con `get_audit_status` pasados unos segundos.
   - Con `project_id` + `url` se crea una ruta puntual (sin monitoreo) solo si el host está permitido para ese proyecto. Hay un tope de 50 rutas puntuales por proyecto.
5. **Antes de cambiar nada** (umbrales, rutas, monitoreo), di qué vas a cambiar y por qué, y confirma con la persona si no lo pidió de forma explícita. Tras cambiar, relee con `get_thresholds` / `get_project` y cuéntalo.
6. **Los umbrales**: subirlos abre alertas en proyectos que hoy están bien; bajarlos o desactivar una métrica silencia el aviso. `set_thresholds` solo toca las métricas que indicas.
7. **Si una auditoría falló** (`status: failed`), el campo `error.code` dice por qué (`TIMEOUT`, `SITE_DOWN`, `HTTP_5XX`, `FORBIDDEN_HOST`…). Los `AUTH_FAILED`, `AUTH_NOT_CONFIGURED` y `AUTH_CONFIG` son de páginas privadas: las credenciales de prueba las corrige la persona administradora en el panel (tú nunca las ves ni las cambias). No reintentes en bucle: informa y, si es razonable, lanza **una** nueva más tarde.

## Cómo presentar los resultados

- Da primero el número y luego el significado: «Rendimiento 72 (mejorable), bajó 11 puntos desde la semana pasada».
- Distingue móvil de escritorio; suelen diferir mucho.
- No presentes un dato de laboratorio como si fuera la experiencia real de los usuarios.
- Si la última auditoría es antigua, di de cuándo es.

## Límites y errores

- 60 llamadas por minuto por clave. Si recibes 429, espera lo que indique `Retry-After`.
- 401: la clave no existe, fue revocada o se rotó (la anterior deja de servir al instante). Pide una nueva a la persona administradora; no insistas con la vieja. 403: origen no permitido. 405: usa POST.
- Los errores de las herramientas llegan como texto claro en español («Proyecto no encontrado.», «El worker de auditorías no está en línea…»). Cuéntaselos a la persona tal cual y no reintentes sin entender la causa.
- Los datos de proyectos y clientes son confidenciales: no los repitas fuera de la conversación y nunca incluyas la clave en lo que escribas.
