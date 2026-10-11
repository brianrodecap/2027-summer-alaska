import { defineConfig } from 'vitest/config';

// `npm run check:import` — runs the real document import (Claude + Google
// Places) on each booking document in attachments/ and compares the result
// with attachments/expected.json. Live API calls and private documents, so
// it's never part of `npm test` or CI. See src/importCheck/attachments.check.ts.
export default defineConfig({
  test: {
    include: ['src/importCheck/**/*.check.ts'],
    environment: 'jsdom', // the import reads files with FileReader
    setupFiles: ['./src/importCheck/setupFetch.ts'],
    testTimeout: 600_000,
  },
});
