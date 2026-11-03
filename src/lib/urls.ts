/**
 * Direcciones legibles del panel: se arman con los identificadores (slug) del cliente y del proyecto,
 * no con los UUID. El slug del proyecto solo es único dentro de su cliente, por eso va anidado.
 */
export const clientPath = (clientSlug: string) => `/admin/clientes/${clientSlug}`;
export const projectPath = (clientSlug: string, projectSlug: string) => `/admin/clientes/${clientSlug}/${projectSlug}`;
/** Portal del cliente: el token ya identifica al cliente, así que el proyecto va solo por su slug. */
export const portalProjectPath = (token: string, projectSlug: string) => `/c/${token}/${projectSlug}`;
