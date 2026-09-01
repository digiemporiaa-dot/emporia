import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "generated/**",
      "coverage/**",
      "next-env.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // CLAUDE.md 2 rule 9: no `any` without a written justification.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": ["warn", { allow: ["error", "warn"] }],
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },
  {
    // Seed and scripts run outside Next and legitimately log progress.
    files: ["prisma/**/*.ts", "scripts/**/*.ts", "tests/**/*.ts"],
    rules: { "no-console": "off" },
  },
];

export default config;
