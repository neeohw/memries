import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '.features-gen/**', 'test-results/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['steps/**/*.ts'],
    rules: {
      // playwright-bdd reads a step's first parameter by name to decide which
      // fixtures to inject, and rejects anything that is not a destructuring
      // pattern ("First argument must use the object destructuring pattern").
      // A step that needs no fixture but does take Gherkin arguments has to
      // write `async ({}, file)`, so the empty pattern is load-bearing here.
      'no-empty-pattern': 'off',
    },
  },
  eslintConfigPrettier,
);
