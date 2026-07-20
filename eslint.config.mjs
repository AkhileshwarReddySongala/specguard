/**
 * ESLint 9 flat configuration.
 *
 * This project has no TypeScript ESLint parser/plugin by design: TypeScript is
 * checked by `npx tsc --noEmit`, while ESLint validates executable JavaScript
 * and configuration files without adding a runtime dependency.
 */
export default [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "coverage/**",
      "**/*.ts",
      "**/*.tsx",
    ],
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
];
