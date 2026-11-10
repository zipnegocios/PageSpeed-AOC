# Borradores de correos al cliente

Estado: **borrador v2, decisiones de forma cerradas**; falta aprobar los textos finales. No hay código escrito. Todo lo que va entre `[corchetes]` es un dato que pone el sistema; las cifras y nombres de los ejemplos son inventados.

Tono: de «tú», cálido y breve (igual que los correos actuales). Firma: **zipnegocios** (siempre en minúsculas y sin espacios).

## Qué cambió en esta versión

1. **Marca**: «zipnegocios», a secas.
2. **Mensaje universal**: ya no depende de WordPress. Sirve igual para WordPress, PrestaShop, Shopify, Joomla y para desarrollos a medida (Next.js, Express, Laravel, Angular, HTML). Ver «Cómo se universaliza».
3. **Un solo correo para todo el equipo del cliente**: un destinatario principal y el resto en copia (CC), con el saludo mencionando a todos. Se quitan las preferencias por persona.
4. **Servidor y servicios**: se redacta como supervisión tuya (hoy manual), sin prometer automatización hasta que esté el panel de Grafana.
5. **Redes sociales por separado**: Instagram, LinkedIn, TikTok, etc., en todo lo que se pueda identificar.

## Decisiones de marca y de forma

| # | Tema | Propuesta |
|---|---|---|
| M1 | Nombre del servicio que ve el cliente | «Informes técnicos web» (ya es el nombre de la app instalable) bajo la firma «zipnegocios». «PageSpeed» queda como nombre interno. *(Confirmado.)* |
| M2 | Firma | Banda superior con el logo de zipnegocios; pie «zipnegocios · Gustavo Amarista · WhatsApp [número]». Hoy los correos dicen «PageSpeed · © zipnegocios». |
| M3 | Remitente | «Gustavo de zipnegocios» `<correo>`, no una dirección «no-reply». El cliente puede responder. |
| M4 | Día y hora | Semanal: lunes por la mañana. Mensual: primer lunes del mes, con el mes anterior completo. |
| M5 | Largo | Cada correo cabe en una pantalla de móvil. Solo el informe manual lleva PDF adjunto. |
| M6 | Pie | Sin enlace de baja individual (ver sección 4): «Para cambiar la frecuencia, respóndeme este correo». |

## Cómo se universaliza el mensaje

El correo no habla de «tu WordPress» ni de «tus plugins». Habla de lo que cuidas, que es igual en todas las tecnologías: **velocidad, visibilidad, tráfico, servidor y servicios, seguridad y actualizaciones**.

Dos datos por proyecto hacen que el texto se ajuste solo:

- **Tecnología** (texto libre que se muestra): «WordPress», «tienda PrestaShop», «Shopify», «aplicación en Next.js», «sitio en HTML»…
- **Servicios incluidos** (casillas): rendimiento, visibilidad (SEO), tráfico, servidor y servicios, seguridad y actualizaciones. Cada bloque del correo aparece solo si está marcado.

Esto evita decir «cuidamos tu servidor» a un cliente de Shopify, donde no hay servidor tuyo, o «tus APIs» a quien no tiene ninguna.

Redacción de cada pieza, sin jerga de una plataforma:

- «Actualicé **[componente]**» en lugar de «actualicé el plugin»: el componente puede ser plugin, módulo, tema, extensión, librería o dependencia.
- «Tu **[sitio / tienda / aplicación]**» según el tipo de proyecto.

## 0. Bienvenida (al crear el acceso)

Se envía cuando generas el PIN y eliges «enviar al correo». Un solo correo para todo el equipo (destinatario principal + CC). Sustituye al correo actual del PIN en la primera vez; el PIN nuevo posterior sigue siendo el correo corto de hoy, también con copia a todos.

**Asunto:** Tu [sitio / tienda / aplicación] ahora tiene seguimiento técnico permanente
**Previsualización:** Qué vas a recibir, cuándo y cómo verlo cuando quieras. No tienes que hacer nada.

> Hola [Ana, Luis y María],
>
> Desde ahora **[sitio]**, [hecho en **[tecnología]**], cuenta con un seguimiento técnico permanente. Lo he incorporado a mi trabajo con ustedes para que su proyecto se mantenga rápido, visible y al día, y para enterarme antes que sus visitantes de cualquier cosa que falle.
>
> Esto aplica a la tecnología que me contrataron, sea un CMS, una tienda online o una aplicación a medida: el seguimiento es el mismo.
>
> **No tienen que hacer nada.** Si algo cambia en Google Analytics, se cae, o una página o producto nuevo necesita ajustes, yo me encargo. Esto es lo que van a recibir:
>
> | Cuándo | Qué | Para qué |
> |---|---|---|
> | **Cada lunes** | Su semana en la web | Cuántas visitas tuvieron, de dónde llegaron (Google, Instagram, LinkedIn…) y qué páginas funcionaron |
> | **Una vez al mes** | Estado general | Velocidad y visibilidad, lo que atendimos y lo que sigue |
> | **Solo si hace falta** | Aviso de incidencia | Les escribo yo cuando algo ya está atendido, o necesito algo de ustedes |
>
> En total, **no más de cinco correos al mes**, salvo que haya una incidencia.
>
> **Qué cuidamos** *(cada línea aparece solo si está en su plan)*
> - **Velocidad y rendimiento**: medido automáticamente en móvil y escritorio.
> - **Visibilidad en buscadores y tráfico**: medido automáticamente.
> - **Servidor, servicios y APIs**: yo los superviso de forma continua.
> - **Seguridad y actualizaciones**: yo las superviso y las aplico.
>
> **Cuando quieran mirar ustedes mismos**, tienen su portal, siempre actualizado. Es un solo acceso para todo el equipo:
>
> [Abrir el portal]  PIN: **[000000]**
>
> Lo pueden instalar como app en el móvil. Si alguien cambia el PIN, les llega a todos.
>
> **Por qué esto importa.** [Tres datos verificables con fuente, ver nota N1.]
>
> Para cambiar la frecuencia de los correos o añadir a alguien más, respóndanme este correo o escríbanme por WhatsApp.
>
> Gustavo Amarista · zipnegocios

**Notas**
- N1. El bloque «Por qué esto importa» lleva **máximo tres datos con fuente citada**, válidos para cualquier tecnología: por ejemplo los umbrales de Core Web Vitals de Google, el fin de soporte de versiones de lenguajes y plataformas, y cifras de vulnerabilidades en componentes de terceros de un informe anual reconocido. Los investigo y los cito antes de la versión final. No pongo porcentajes sin fuente.
- N2. Cuando el panel de Grafana esté en marcha, la línea del servidor pasa a «monitoreo con alertas automáticas». La estructura del correo no cambia.
- N3. Si un proyecto es de una sola persona, el saludo es «Hola Ana,» y «ustedes» pasa a «tú». Ver «Saludo y destinatarios» en la sección 4.
- N4. La hoja de vida (diagnóstico, optimización, vigilancia, mantenimiento) es un gráfico que se puede añadir en la fase de diseño.

## 1. Estado general del mes (mensual)

**Asunto:** [Sitio]: octubre en orden. Rendimiento [82], [+4] sobre septiembre
**Previsualización:** Lo que revisamos, lo que atendimos y lo que viene.

> Hola [Ana, Luis y María],
>
> Este es el resumen de octubre de **[sitio]**.
>
> **[Una frase de estado, por reglas]**
> Ejemplos: «Todo en orden: no hubo incidencias» / «Mejoró la velocidad en el móvil y atendimos un aviso en la página de contacto» / «Hay un punto que merece atención, les explico abajo».
>
> **En números** (promedio del mes, frente a septiembre)
>
> | | Móvil | Escritorio |
> |---|---|---|
> | Rendimiento | [78] ([+5]) | [91] ([+2]) |
> | Visibilidad (SEO) | [95] (=) | [96] (=) |
> | Accesibilidad | [88] ([+1]) | [88] ([+1]) |
>
> **Servidor y servicios** *(solo si está en su plan)*: [supervisados durante todo el mes, sin incidencias].
>
> **Lo que atendimos este mes**
> - [14 oct] Actualicé [**componente**] a su última versión.
> - [18 oct] Ajusté las imágenes de la página [Servicios], que tardaba en cargar en el móvil.
> - [25 oct] Detecté una caída de velocidad tras [un cambio] y la corregí el mismo día.
>
> **Lo que viene**
> - [Revisión trimestral de tecnologías y versiones, en noviembre.]
>
> **Páginas nuevas que detectamos**: [2 páginas nuevas en octubre, ya en seguimiento].
>
> [Ver el detalle en el portal]   [Descargar el informe en PDF]
>
> Cualquier cosa que quieran que revise, respóndanme este correo.
>
> Gustavo Amarista · zipnegocios

**Notas**
- N5. «Lo que atendimos» **no sale de las auditorías**: hace falta un **registro de actuaciones** (tus notas, con fecha y página). Sin actuaciones, la sección dice «Este mes no hizo falta intervenir: todo se mantuvo estable», que también es un mensaje de valor.
- N6. **«Servidor y servicios: sin incidencias» lo confirmas tú.** Hoy esa supervisión es manual, así que el sistema no puede saberlo. Propongo un clic mensual por proyecto en el panel («Confirmo que revisé») antes del envío. Si no lo marcas, la línea no sale. Cuando exista el panel de Grafana, esa confirmación pasa a ser automática.
- N7. La frase de estado son tres plantillas por regla (todo bien, mejora, atención). No la redacta una IA, para que nunca diga algo falso.
- N8. Si el mes no tiene auditorías (proyecto en desarrollo o sin datos), no se envía.

## 2. Su semana en la web (semanal)

**Asunto:** Su semana en la web: [1.240] visitas ([+8 %]) · 2 al 8 de nov
**Previsualización:** De dónde llegaron y qué páginas funcionaron.

> Hola [Ana, Luis y María],
>
> Así fue la semana del **2 al 8 de noviembre** en **[sitio]**.
>
> **[1.240] visitas** · [+8 %] frente a la semana anterior
> Clics desde Google: [310] ([+12 %]) · Veces que aparecieron: [9.800]
>
> **De dónde llegaron**
>
> | Origen | Visitas | Cambio |
> |---|---|---|
> | Google (búsqueda) | [610] | [+11 %] |
> | Instagram | [140] | [+9 %] |
> | LinkedIn | [85] | [+30 %] |
> | TikTok | [40] | [nuevo] |
> | Facebook | [25] | [-5 %] |
> | Otras redes | [10] | [=] |
> | Directo o sin identificar | [220] | [-4 %] |
> | Otros sitios | [90] | [+20 %] |
> | Asistentes de IA (mínimo observado) | [30] | [nuevo] |
>
> **Las 3 páginas más vistas**
> 1. [Inicio] · [480]
> 2. [Servicios] · [210]
> 3. [Contacto] · [95]
>
> **En una línea:** [Frase por reglas, solo descriptiva: «Semana estable, con más llegada desde Google» / «Subieron las visitas desde LinkedIn». Ver N11].
>
> [Ver más en el portal]
>
> Gustavo Amarista · zipnegocios
>
> *Datos hasta el [8 nov]. Para cambiar la frecuencia, respóndeme este correo.*

**Notas**
- N9. **Redes por separado.** Hoy se guarda el *canal* de GA4 (todo lo social junto). Para separar Instagram, LinkedIn, TikTok, etc. hay que sumar la **fuente** de GA4 a la descarga diaria y mantener una tabla de equivalencias (por ejemplo `l.instagram.com` y `instagram` → Instagram; `lnkd.in` y `linkedin.com` → LinkedIn). Se muestran solo las redes que tuvieron visitas. Lo que no se reconoce va a «Otras redes» o «Otros sitios». Las equivalencias se pueden ampliar con el tiempo.
- N10. **Límite real de la identificación.** Muchas aplicaciones abren los enlaces en su navegador interno y no informan de dónde viene la visita (suele pasar con TikTok, Instagram y WhatsApp). Esa visita llega a GA4 como «directo». Por eso la fila se llama «Directo o sin identificar». La mejora práctica es usar enlaces con etiquetas UTM en las biografías y campañas; en el correo mensual puedo añadir un consejo breve sobre eso y prepararles los enlaces. Antes de la versión final verifico estos comportamientos con datos reales de un cliente.
- N11. Las frases **no atribuyen causas** («por tu publicación del jueves»), porque el sistema no las conoce.
- N12. Se habla de **visitas (sesiones)**, no de «personas» ni «usuarios»: el sistema no los cuenta por diseño, para no sumar dos veces a la misma persona.
- N13. «Asistentes de IA» siempre aparece como **mínimo observado**.
- N14. Si GA4 no está conectado: el cliente **no recibe** este correo. Si falló la descarga de la semana, sale con «datos hasta el día X» o se retrasa; nunca con una cifra incompleta presentada como completa.
- N15. Respeta el interruptor «el cliente ve el tráfico» del proyecto: apagado, no se envía.
- N16. Semana con muy pocas visitas: tono neutro («Semana tranquila: [12] visitas») y sin porcentajes sobre cifras muy pequeñas.

## 3. Informe enviado a mano («Enviar a …»)

Es el correo que ya existe, con el PDF adjunto. Cambia el tono, la firma y los destinatarios (principal + CC).

**Asunto actual:** `Informe de [proyecto]`
**Asunto propuesto:** Informe de [proyecto] · [últimos 30 días]

> Hola [Ana, Luis y María],
>
> Les adjunto el informe de **[proyecto]** de los últimos [30 días]: cómo está cada página en móvil y escritorio, qué mejoró y qué sigue en revisión.
>
> **Lo más importante:** [una frase, igual que la del correo mensual].
>
> Siempre pueden ver el estado actualizado en su portal:
>
> [Abrir el portal]
>
> Gustavo Amarista · zipnegocios

**Notas**
- N17. Hoy dice «Te enviamos el informe…». Cambia a primera persona del singular, como el resto.
- N18. Es el único correo con adjunto.
- N19. Sigue con su bloqueo de 5 minutos entre envíos.

## 4. Destinatarios: uno principal y el resto en copia

**Decisión tomada para esta etapa:** un contacto principal por cliente, más una lista de personas **en copia (CC)**. Un solo correo por envío, un solo acceso al portal, sin permisos ni preferencias por persona.

**Cómo funciona**
- Ficha del cliente: contacto principal (el actual) + lista «En copia» con nombre y correo de cada persona. Rol opcional, solo informativo.
- Todo correo al cliente (bienvenida, mensual, semanal, manual, PIN) va **Para** el principal y **CC** a la lista.
- El portal sigue con **un PIN por cliente**. Si cualquiera pide un PIN nuevo desde la pantalla del PIN, o lo generas tú, **llega a todos**, y se cierran las sesiones abiertas (como hoy).
- Las preferencias (qué reportes y con qué frecuencia) se fijan **por cliente** desde el panel, no por persona.

**Saludo y destinatarios**

| Personas | Saludo |
|---|---|
| 1 | «Hola Ana,» |
| 2 o 3 | «Hola Ana, Luis y María,» |
| 4 o más | «Hola equipo de [cliente],» |

Alternativa si prefieres un tono más formal: una línea de encabezado «Con atención a Ana, Luis y María». Es solo cambiar la plantilla.

**Detalles a tener en cuenta**
- **Respuestas**: un «responder a todos» llega a ti y al equipo. Es lo normal en un hilo de proyecto. Como remitente real eres tú.
- **Privacidad**: todos ven las direcciones de los demás (CC, no CCO). Es lo que pides y es coherente con un mismo equipo; conviene que el cliente lo sepa al añadir a alguien.
- **Sin enlace de baja individual**: un enlace en un correo con copia podría apagar el envío de todo el equipo por un clic accidental. Por eso el pie dice «Para cambiar la frecuencia, respóndeme este correo».
- **Rebotes**: si una dirección rebota, se anota en la bitácora y se ve en la ficha del cliente.
- **Qué cambia en el código actual**: hoy el envío del PIN, el aviso de PIN y el informe manual usan solo `contact_email`. Habrá que sumarles la lista en copia, y el pedido de «PIN nuevo» desde el portal también.

## Qué falta construir (resumen)

1. Campos de proyecto: **tecnología** (texto) y **servicios incluidos** (casillas).
2. Lista **«En copia»** por cliente y su uso en todos los correos, incluido el PIN.
3. Preferencias de frecuencia **por cliente**.
4. Cron de envío en el worker: semanal y mensual, con la regla de «no enviar si faltan datos».
5. Plantillas HTML con la marca de zipnegocios (las cuatro de este documento).
6. Registro de actuaciones técnicas y la confirmación mensual «revisé el servidor».
7. Fuente de GA4 en la descarga y tabla de equivalencias de redes.
8. Detección de páginas nuevas (sitemap) para «Páginas nuevas que detectamos».
9. Cambiar «Zip Negocios» por «zipnegocios» en `src/lib/contact.ts` y en los textos que hoy usan «PageSpeed» frente al cliente (cuando se implemente).

Nada de esto toca lo ya construido: las auditorías, el portal y las alertas siguen como están.

## Decisiones cerradas

- **Nombre del servicio:** «Informes técnicos web», bajo la firma «zipnegocios».
- **Trato:** «tú» cuando el destinatario es una sola persona y «ustedes» cuando hay varias.
- **Lista de copia:** en el correo solo aparecen los nombres. El rol, si se anota, queda como nota interna en el panel.

## Siguiente paso

Rellenar el bloque «Por qué esto importa» con datos citados con fuente y verificar con datos reales de un cliente cómo llegan las redes sociales (nota N10). Después, la versión visual de los correos y el documento de estrategia.
