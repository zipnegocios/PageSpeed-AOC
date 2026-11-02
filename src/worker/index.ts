// Proceso independiente del worker (BullMQ + Lighthouse). Implementación completa en M2.
// No debe importar next/* ni server-only.
import { env } from "@/server/config/env";

function main() {
  const config = env();
  console.log(
    JSON.stringify({
      msg: "worker boot (M0 stub)",
      cooldownMs: config.AUDIT_COOLDOWN_MS,
      attempts: config.AUDIT_ATTEMPTS,
    }),
  );
}

main();
