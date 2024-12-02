import globals from "globals";
import pluginJs from "@eslint/js";


/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    files: ["src/**/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: globals.node,
    },
    rules: {
      'no-unused-vars': ["error", {
        caughtErrors: "none",
      }]
    },
  },
  pluginJs.configs.recommended,
];
