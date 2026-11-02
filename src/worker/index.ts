// Proceso independiente del worker (BullMQ + Lighthouse). No importa next/* ni server-only.
import { parseWorkerEnv } from "@/server/config/env";
import { startWorker } from "./start";

async function main() {
  let env;
  try {
    env = parseWorkerEnv(process.env);
  } catch (err) {
    console.error(`[worker] ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  const worker = await startWorker({ env });

  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[worker] ${signal} recibido: terminando la auditoría en curso y saliendo`);
    worker.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
}

main().catch((err) => {
  console.error("[worker] fallo al iniciar:", err instanceof Error ? err.message : err);
  process.exit(1);
});
