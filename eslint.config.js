import { defineConfig } from "eslint/config";
import globals from "globals";

const sharedRules = {
  "no-undef": "error",
  "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
  "prefer-const": "error",
};

export default defineConfig([
  {
    ignores: ["dist/**", "node_modules/**", "public/data/**", "data/source/**"],
  },
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.browser,
    },
    rules: sharedRules,
  },
  {
    files: ["scripts/**/*.mjs", "src/**/*.test.js", "vite.config.js", "eslint.config.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.node,
    },
    rules: sharedRules,
  },
]);
