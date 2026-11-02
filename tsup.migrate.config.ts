import { defineConfig } from "tsup";

// Empaqueta el ejecutor de migraciones como un único archivo autónomo para el contenedor web
// (la imagen standalone de Next no incluye drizzle-orm ni pg para uso fuera de Next).
export default defineConfig({
  entry: ["src/server/db/migrate-cli.ts"],
  format: ["cjs"],
  target: "node22",
  outDir: "dist",
  splitting: false,
  clean: false,
  noExternal: [/.*/],
  external: ["pg-native"],
});
