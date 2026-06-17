// ESLint flat config. Philosophy: errors = real bugs (undefined vars, unsafe
// patterns); warnings = hygiene (unused vars / dead code) to be ratcheted down
// over time. CI fails on errors only.
import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: [
      "node_modules/**",
      "backups/**",
      "deploy/**",
      "coverage/**",
      "prisma/migrations/**",
      "e2e-*.mjs", // local Playwright/fetch verification harnesses (need a running app, not part of CI lint)
    ],
  },
  js.configs.recommended,
  {
    files: ["src/**/*.js", "prisma/**/*.js", "eslint.config.js", "vitest.config.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      eqeqeq: ["warn", "smart"],
      "no-console": "off",
    },
  },
  {
    // Browser SPA (no bundler, ES module via <script type="module">).
    files: ["public/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.browser },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      eqeqeq: ["warn", "smart"],
    },
  },
  {
    files: ["tests/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
];
