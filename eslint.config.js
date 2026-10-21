import { builtinModules } from 'node:module';

import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Node built-ins a test may import: pure helpers that can't reach files or
// processes. A test needing another pure one adds it here.
const testBuiltins = ['url'];
// Every other built-in, bare or node:-prefixed, with its subpaths. The list
// follows the Node running ESLint; built-ins added since Node 18 are node:-only
// (node:sqlite, node:test), so the node: branch covers them in every version.
// The subpath slash is a unicode escape: the same pattern goes into selector
// regexes, which end at the first literal slash.
const blockedBuiltin = `^(?!(node:)?(${testBuiltins.join('|')})$)(node:.+|(${builtinModules
  .filter((name) => !name.includes('/'))
  .join('|')})(\\u002F.*)?)$`;
const realDataDirs = ['public', 'attachments'];
const builtinMessage =
  'Tests import only the Node built-ins in testBuiltins (eslint.config.js); fixtures and stubs stand in for files and processes.';
// process members that reach modules, files or other processes without an import.
const processEscapes = 'getBuiltinModule|binding|_linkedBinding|dlopen|kill';
const realDataMessage = 'Tests use synthetic fixtures, never real trip data or attachments.';

// TS/TSX files are parsed by typescript-eslint without a TS program: syntax-only
// linting, no type-aware rules. Its eslintRecommended block turns off the core
// rules tsc already checks (and that misfire on TS syntax such as overloads).
// Full type checking (including unused locals/params, via tsconfig.app.json's
// noUnusedLocals/noUnusedParameters) still happens via `tsc -b` in `npm run validate` —
// don't duplicate unused-var/import detection here.
export default [
  { ignores: ['dist', 'docs/js', 'coverage'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'no-unused-vars': 'off', // tsc -b (noUnusedLocals/noUnusedParameters) already enforces this, with full type info
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
    },
  },
  tseslint.configs.eslintRecommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser },
    rules: {
      // A let read by a closure created before its one assignment can't be const.
      'prefer-const': ['error', { ignoreReadBeforeAssign: true }],
    },
  },
  {
    // Tests use synthetic in-memory fixtures: no files, no real trip data or bookings.
    files: ['src/**/*.test.{ts,tsx}', 'src/test/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { regex: blockedBuiltin, message: builtinMessage },
            { group: realDataDirs.map((dir) => `**/${dir}/**`), message: realDataMessage },
          ],
        },
      ],
      // no-restricted-imports sees only static imports; these cover import() and
      // vitest's loaders, each by the node that holds its path.
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.type='MetaProperty'][property.name=/^glob/]",
          message: 'Tests use in-memory fixtures, never files loaded by import.meta.glob.',
        },
        {
          // process.x, process['x'] and globalThis.process.x, or x destructured from process.
          selector: [
            `MemberExpression[property.name=/^(${processEscapes})$/]:matches([object.name='process'], [object.property.name='process'])`,
            `MemberExpression[property.value=/^(${processEscapes})$/]:matches([object.name='process'], [object.property.name='process'])`,
            `VariableDeclarator[init.name='process'] > ObjectPattern > Property[key.name=/^(${processEscapes})$/]`,
          ].join(', '),
          message: builtinMessage,
        },
        ...[
          ['ImportExpression', 'source'],
          [
            "CallExpression[callee.object.name='vi'][callee.property.name=/^(mock|doMock|importActual|importMock)$/]",
            'arguments.0',
          ],
        ].flatMap(([loader, path]) => [
          {
            selector: `${loader}[${path}.type!='Literal']`,
            message: 'Tests import by a literal path, so the restricted-import rules can check it.',
          },
          {
            selector: `${loader}[${path}.value=/${blockedBuiltin}/]`,
            message: builtinMessage,
          },
          {
            // Case-insensitive, like the file systems the tests run on.
            selector: `${loader}[${path}.value=/(^|\\u002F)(${realDataDirs.join('|')})\\u002F/i]`,
            message: realDataMessage,
          },
        ]),
      ],
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  prettierConfig,
];
