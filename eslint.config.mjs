import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Outros workspaces do monorepo (RN/Expo, pacotes compartilhados) — não
    // são código Next.js e têm suas próprias regras de lint.
    "mobile/**",
    "packages/**",
    // Scripts de build Node.js (CommonJS), não fazem parte do bundle da app.
    "scripts/**",
  ]),
]);

export default eslintConfig;