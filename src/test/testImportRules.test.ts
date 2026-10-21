import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// The lint rules that keep tests off real files and trip data, run through the
// repo's own eslint.config.js on in-memory snippets.
const eslint = new ESLint({ cwd: fileURLToPath(new URL('../..', import.meta.url)) });
const TEST_FILE = 'src/model/example.test.ts';
// The first lint loads the config, plugins and parser, which takes seconds; do
// it once here, not in a case.
await eslint.lintText('', { filePath: TEST_FILE });

async function messages(code: string, filePath = TEST_FILE): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.map((m) => m.message);
}

const NO_BUILTIN =
  'Tests import only the Node built-ins in testBuiltins (eslint.config.js); fixtures and stubs stand in for files and processes.';
const NO_REAL_DATA = 'Tests use synthetic fixtures, never real trip data or attachments.';
const LITERAL_PATH = 'Tests import by a literal path, so the restricted-import rules can check it.';
const NO_GLOB = 'Tests use in-memory fixtures, never files loaded by import.meta.glob.';
const GLOB = "export const m = import.meta.glob('../../public/data/*.json');";

describe('test import rules', () => {
  it.each([
    [GLOB, NO_GLOB],
    ["const p = './x';\nexport const m = await import(p);", LITERAL_PATH],
    ['export const m = await import(`./x`);', LITERAL_PATH],
    ["export const m = await import('../../public/data/trips.json');", NO_REAL_DATA],
    ["export const m = await import('../attachments/a.json');", NO_REAL_DATA],
    ["export const m = await import('node:fs');", NO_BUILTIN],
    ["export const m = await import('fs/promises');", NO_BUILTIN],
    ["export const m = await import('node:readline');", NO_BUILTIN],
    ["export const m = await import('node:sqlite');", NO_BUILTIN],
    ["export const m = await import('node:url/');", NO_BUILTIN],
    ["export const fs = process.getBuiltinModule('fs');", NO_BUILTIN],
    ["export const fs = process['getBuiltinModule']('fs');", NO_BUILTIN],
    [
      "const { getBuiltinModule } = process;\nexport const fs = getBuiltinModule('fs');",
      NO_BUILTIN,
    ],
    ["export const fs = globalThis.process.getBuiltinModule('fs');", NO_BUILTIN],
    ["export const fs = process.binding('fs');", NO_BUILTIN],
    ['process.kill(1);', NO_BUILTIN],
    ["export const m = await import('../../Public/data/trips.json');", NO_REAL_DATA],
    ["export const m = await vi.importActual('node:fs');", NO_BUILTIN],
    ["export const m = await vi.importMock('../../public/data/trips.json');", NO_REAL_DATA],
    ["vi.mock('../../attachments/a.json');", NO_REAL_DATA],
    ["const p = './x';\nvi.doMock(p);", LITERAL_PATH],
  ])('refuses %j', async (code, message) => {
    expect(await messages(code)).toEqual([message]);
  });

  // no-restricted-imports prefixes the custom message with the import path.
  it.each([
    ["import trips from '../../public/data/trips.json';\nexport { trips };", NO_REAL_DATA],
    ["import { readFileSync } from 'node:fs';\nexport { readFileSync };", NO_BUILTIN],
    ["import { execSync } from 'child_process';\nexport { execSync };", NO_BUILTIN],
    ["import { createRequire } from 'node:module';\nexport { createRequire };", NO_BUILTIN],
    ["import u from 'url/x';\nexport { u };", NO_BUILTIN],
  ])('refuses the static import %j', async (code, message) => {
    expect(await messages(code)).toEqual([expect.stringContaining(message)]);
  });

  it.each([
    "export const m = await import('./tripModel');",
    "export const m = await import('./publicView');",
    "export const m = await import('fsx');",
    "export const m = await vi.importActual('./tripModel');",
    "vi.mock('./tripModel', async (importOriginal) => ({ ...(await importOriginal()) }));",
    "import { fileURLToPath } from 'node:url';\nexport { fileURLToPath };",
    "export const m = await import('url');",
    "export const m = await vi.importActual('node:url');",
    'export const env = process.env.NODE_ENV;',
    'const binding = 1;\nexport { binding };',
  ])('allows a source module or an allowed built-in: %j', async (code) => {
    expect(await messages(code)).toEqual([]);
  });

  it('applies only to tests and test helpers', async () => {
    expect(await messages(GLOB, 'src/model/example.ts')).toEqual([]);
    expect(await messages(GLOB, 'src/test/helper.ts')).toEqual([NO_GLOB]);
    expect(await messages(GLOB, 'src/components/Example.test.tsx')).toEqual([NO_GLOB]);
  });
});
