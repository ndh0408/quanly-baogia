// ESLint flat config. Philosophy: errors = real bugs (undefined vars, unsafe
// patterns); warnings = hygiene (unused vars / dead code) to be ratcheted down
// over time. CI fails on errors only.
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

// Toàn bộ file TypeScript trong repo (backend + frontend React + gói dùng chung).
const TS_FILES = ["src/**/*.ts", "web/src/**/*.{ts,tsx}", "shared/**/*.ts", "prisma.config.ts"];

export default [
  {
    ignores: [
      "node_modules/**",
      "backups/**",
      "deploy/**",
      "coverage/**",
      "prisma/migrations/**",
      "public/app2/**", // bundle Vite build ra (generated) — lint source ở web/src, không lint output
      ".scan/**",
      "e2e-*.mjs", // local Playwright/fetch verification harnesses (need a running app, not part of CI lint)
    ],
  },
  js.configs.recommended,
  {
    files: ["src/**/*.js", "prisma/**/*.{js,mjs}", "scripts/**/*.{js,mjs}", "eslint.config.js", "vitest.config.js"],
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
  // TypeScript (trước đây bị BỎ QUA hoàn toàn — "File ignored"): parser + bộ recommended
  // KHÔNG-type-checked (type safety đã có tsc --noEmit lo; eslint bắt bug pattern).
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: TS_FILES })),
  {
    files: TS_FILES,
    rules: {
      // Codebase dùng `any` chủ đích ở ranh giới Prisma/req.query (đã bàn ở modernization) — không cấm.
      "@typescript-eslint/no-explicit-any": "off",
      // ignoreRestSiblings: mẫu strip-PII `const { before, after, ...rest } = r` là cố ý.
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true, caughtErrors: "none" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      eqeqeq: ["warn", "smart"],
    },
  },
  // React hooks (chỉ app React): rules-of-hooks bắt bug thật (gọi hook trong điều kiện/vòng lặp);
  // exhaustive-deps để warn — codebase có chỗ CỐ Ý bỏ dep (đã đánh dấu eslint-disable tại chỗ).
  {
    files: ["web/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];
