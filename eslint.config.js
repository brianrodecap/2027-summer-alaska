import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';

// TypeScript 7.0.2 (this repo's pinned compiler) is newer than typescript-eslint
// supports (it hard-rejects any TS >=7.0), so TS/TSX files are parsed here via
// Babel's TypeScript preset instead — syntax-only linting, no type-aware rules.
// Full type checking (including unused locals/params, via tsconfig.app.json's
// noUnusedLocals/noUnusedParameters) still happens via `tsc -b` in `npm run validate` —
// don't duplicate unused-var/import detection here, since a syntax-only parser can't
// tell a type-only import from a genuinely unused one.
export default [
  { ignores: ['dist', 'docs/js', 'coverage'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.browser,
      parser: (await import('@babel/eslint-parser')).default,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          presets: ['@babel/preset-react', '@babel/preset-typescript'],
        },
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'no-unused-vars': 'off', // tsc -b (noUnusedLocals/noUnusedParameters) already enforces this, with full type info
      'no-undef': 'off', // TS/Babel-parsed files: type-only symbols aren't real runtime globals
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
    },
  },
  prettierConfig,
];
