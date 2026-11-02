// Worker para DESARROLLO LOCAL: permite auditar sitios en localhost (allowPrivate).
// No se incluye en la imagen de producción. Uso: pnpm exec tsx scripts/dev-worker.ts
import { parseWorkerEnv } from "../src/server/config/env";
import { startWorker } from "../src/worker/start";

const env = parseWorkerEnv(process.env);
const worker = await startWorker({ env, allowPrivate: true });
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => worker.close().then(() => process.exit(0)));
}
