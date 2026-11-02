import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Reglas de capas (ver plan, sección 2):
//  - app/** y mcp/** solo hablan con server/services (nunca repositories ni db).
//  - server/** y worker/** no importan next/* (el worker corre fuera de Next).
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "dist/**", "next-env.d.ts", "drizzle/**"]),
  {
    files: ["src/app/**/*.{ts,tsx}", "src/mcp/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/server/repositories/*", "@/server/db/*", "@/server/db"], message: "Usa @/server/services." },
          ],
        },
      ],
    },
  },
  {
    files: ["src/server/**/*.ts", "src/worker/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["next", "next/*", "server-only"], message: "server/ y worker/ no dependen de Next." }] },
      ],
    },
  },
]);
