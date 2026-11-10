import { average } from "./history";

/**
 * El árbol de páginas del portal, derivado de las rutas (la tabla `routes` es plana). Lógica pura.
 *  - «/» es un nodo propio («Inicio») sin hijos; el resto cuelga de su primer segmento.
 *  - Una página puede ser a la vez ruta y padre (`/servicios` y `/servicios/x`).
 *  - Si solo existe `/productos/x`, `/productos` es un nodo virtual (sin auditoría propia) con el promedio de lo que contiene.
 *  - Las mejoras de un nodo suben a sus padres: `totalImprovements` = las suyas + las de todo lo que contiene.
 */
export type Profile = "mobile" | "desktop";
export const SCORE_KEYS = ["performance", "seo", "accessibility", "best_practices"] as const;

export type ProfileScores = {
  scores: Record<(typeof SCORE_KEYS)[number], number | null>;
  agentic: { passed: number; total: number } | null;
};

export type TreePage<S extends ProfileScores = ProfileScores> = {
  routeId: string;
  path: string;
  title: string;
  /** Mejoras abiertas de esta ruta (en cualquier perfil). */
  improvements: number;
  profiles: Partial<Record<Profile, S>>;
};

export type TreeNode<S extends ProfileScores = ProfileScores> = {
  /** La ruta completa del nodo (`/servicios`); única en el árbol. */
  path: string;
  title: string;
  /** null = nodo virtual: no hay ruta auditada con exactamente esta dirección. */
  page: TreePage<S> | null;
  children: TreeNode<S>[];
  ownImprovements: number;
  totalImprovements: number;
  /** Promedio por perfil de todas las páginas del nodo y de lo que contiene (para los nodos virtuales). */
  group: Partial<Record<Profile, ProfileScores>>;
};

function averageProfile(list: ProfileScores[]): ProfileScores | null {
  if (list.length === 0) return null;
  const agentic = list.flatMap((p) => (p.agentic ? [p.agentic] : []));
  return {
    scores: Object.fromEntries(SCORE_KEYS.map((k) => [k, average(list.map((p) => p.scores[k]))])) as ProfileScores["scores"],
    agentic: agentic.length === 0 ? null : { passed: agentic.reduce((a, x) => a + x.passed, 0), total: agentic.reduce((a, x) => a + x.total, 0) },
  };
}

const byTitle = (a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title, "es", { sensitivity: "base", numeric: true });

export function buildRouteTree<S extends ProfileScores>(pages: TreePage<S>[], virtualTitle: (path: string) => string): TreeNode<S>[] {
  const nodes = new Map<string, TreeNode<S>>();
  const roots: TreeNode<S>[] = [];

  const ensure = (path: string, parent: TreeNode<S> | null): TreeNode<S> => {
    const found = nodes.get(path);
    if (found) return found;
    const node: TreeNode<S> = { path, title: virtualTitle(path), page: null, children: [], ownImprovements: 0, totalImprovements: 0, group: {} };
    nodes.set(path, node);
    (parent ? parent.children : roots).push(node);
    return node;
  };

  for (const page of [...pages].sort((a, b) => a.path.localeCompare(b.path))) {
    const segments = page.path.split("/").filter(Boolean);
    let parent: TreeNode<S> | null = null;
    let node: TreeNode<S>;
    if (segments.length === 0) node = ensure("/", null);
    else {
      node = null as unknown as TreeNode<S>;
      for (let i = 0; i < segments.length; i++) {
        node = ensure(`/${segments.slice(0, i + 1).join("/")}`, parent);
        parent = node;
      }
    }
    node.page = page;
    node.title = page.title;
    node.ownImprovements = page.improvements;
  }

  const finish = (node: TreeNode<S>): void => {
    node.children.sort(byTitle);
    node.totalImprovements = node.ownImprovements;
    for (const child of node.children) {
      finish(child);
      node.totalImprovements += child.totalImprovements;
    }
    const collect = (n: TreeNode<S>, p: Profile): ProfileScores[] => [
      ...(n.page?.profiles[p] ? [n.page.profiles[p]!] : []),
      ...n.children.flatMap((c) => collect(c, p)),
    ];
    for (const p of ["mobile", "desktop"] as const) {
      const avg = averageProfile(collect(node, p));
      if (avg) node.group[p] = avg;
    }
  };
  for (const r of roots) finish(r);

  // «Inicio» siempre primero; el resto por título.
  roots.sort((a, b) => (a.path === "/" ? -1 : b.path === "/" ? 1 : byTitle(a, b)));
  return roots;
}

/** Cantidad de páginas (nodos con auditoría propia) de un árbol. */
export function countPages<S extends ProfileScores>(nodes: TreeNode<S>[]): number {
  return nodes.reduce((n, node) => n + (node.page ? 1 : 0) + countPages(node.children), 0);
}
