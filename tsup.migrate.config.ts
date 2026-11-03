import { defineConfig } from "tsup";

// Empaqueta el ejecutor de migraciones y la restauración de respaldos como archivos autónomos para el contenedor web
// (la imagen standalone de Next no incluye drizzle-orm ni pg para uso fuera de Next).
export default defineConfig({
  entry: { "migrate-cli": "src/server/db/migrate-cli.ts", "restore-cli": "src/server/backup/restore-cli.ts" },
  format: ["cjs"],
  target: "node22",
  outDir: "dist",
  splitting: false,
  clean: false,
  noExternal: [/.*/],
  external: ["pg-native"],
});
