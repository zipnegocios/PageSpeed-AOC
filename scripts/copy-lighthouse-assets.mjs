// El informe oficial de Lighthouse carga su generador, su plantilla y su JavaScript del propio paquete en tiempo de
// ejecución, y el rastreo de Next no los incluye en la imagen "standalone" (el paquete está tras enlaces de pnpm).
// Tras compilar, se copian a donde el servidor standalone los va a buscar. Uso: node scripts/copy-lighthouse-assets.mjs
import { cpSync, existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const source = dirname(require.resolve("lighthouse/package.json"));
const standaloneLink = new URL("../.next/standalone/node_modules/lighthouse", import.meta.url).pathname;
if (!existsSync(standaloneLink)) {
  console.log("copy-lighthouse-assets: no hay salida standalone, no se copia nada.");
  process.exit(0);
}
const target = realpathSync(standaloneLink);
// Solo lo que usa el informe y la traducción (≈ 20 MB): el generador, sus plantillas y JavaScript, y las traducciones.
const parts = ["report", "flow-report", "dist", "shared"];
for (const part of parts) {
  cpSync(join(source, part), join(target, part), { recursive: true, force: true });
}
console.log(`copy-lighthouse-assets: ${parts.join(", ")} -> ${target}`);
