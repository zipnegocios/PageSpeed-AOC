// Lee las versiones que fija pnpm-lock.yaml. El worker las usa para instalar exactamente lo que se probó, en lugar de
// que `npm install` resuelva versiones nuevas de las dependencias indirectas (y falle cuando un proveedor publica sus
// paquetes a medias, o corra con versiones que nadie probó).

/** Nombre y versión de cada paquete de la sección `packages:` del lockfile (v9). */
export function lockedVersions(lockText) {
  const versions = new Map();
  let inPackages = false;
  for (const line of lockText.split("\n")) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages && /^\S/.test(line)) break; // otra sección de primer nivel (snapshots:)
    if (!inPackages) continue;
    const m = /^  '?(@?[^@\s']+)@([^\s':]+)'?:\s*$/.exec(line);
    if (!m) continue;
    const set = versions.get(m[1]) ?? new Set();
    set.add(m[2]);
    versions.set(m[1], set);
  }
  return versions;
}

/**
 * `overrides` de npm que fijan cada paquete del lockfile a su versión. Solo los que tienen una única versión: los que
 * aparecen con varias (por ejemplo, dos mayores) quedan libres para que cada dependiente use la suya. Los directos ya
 * van fijados en `dependencies` y se omiten.
 */
export function lockOverrides(lockText, direct) {
  const skip = new Set(direct);
  const out = {};
  for (const [name, set] of [...lockedVersions(lockText)].sort(([a], [b]) => a.localeCompare(b))) {
    if (set.size === 1 && !skip.has(name)) out[name] = [...set][0];
  }
  return out;
}
