import { afterEach, expect } from 'vitest';

import { BlockedStorage } from './memoryStorage';

// Tests run in Node with no browser globals: code that reads storage, IndexedDB,
// the clock or the network takes it as a parameter, and a test passes a stub.

// Tests never reach the network. Each attempt is recorded, so code that swallows
// the error still fails the test.
const networkCalls: string[] = [];
globalThis.fetch = (input) => {
  const call = `fetch(${input instanceof Request ? input.url : String(input)})`;
  networkCalls.push(call);
  return Promise.reject(new Error(`${call} in a test: stub it with a fixture.`));
};
afterEach(() => {
  expect(networkCalls.splice(0), 'network calls; stub them with fixtures').toEqual([]);
});

// Code that falls back to the browser's localStorage finds it blocked, as in a
// private window, whatever the Node version ships: every read and write throws
// (so safeStorage's reads find nothing). A test that needs it stored replaces it.
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: new BlockedStorage(),
});
