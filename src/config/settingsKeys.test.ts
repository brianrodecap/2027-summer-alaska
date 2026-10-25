import { beforeAll, describe, expect, it } from 'vitest';

import { createMessage } from '../model/anthropicClient';
import { googleApiFetch } from '../model/googleApiFetch';
import { fakeAnthropic, fakeMessage } from '../test/fakeAnthropic';
import { MemoryStorage } from '../test/memoryStorage';

// The edge clients' default key is the one Settings saved on an earlier visit,
// under the storage names Settings has always used.
beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new MemoryStorage({ aiApiKey: 'sk-settings', googleApiKey: 'AIza-settings' }),
  });
});

describe('a client given no key', () => {
  it("sends Anthropic Settings' key", async () => {
    const {
      sent,
      options: { fetch },
    } = fakeAnthropic({ body: fakeMessage([{ type: 'text', text: 'hi' }]) });
    await createMessage(
      { max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] },
      (message) => new Error(message),
      'declined',
      { fetch },
    );
    expect(sent[0].headers.get('x-api-key')).toBe('sk-settings');
  });

  it("sends Google Settings' key", async () => {
    let key: string | null = null;
    await googleApiFetch('Places API', 'https://example.test', 'id', {
      fetch: async (_url, init) => {
        key = new Headers(init?.headers).get('X-Goog-Api-Key');
        return new Response('{}', { status: 200 });
      },
    });
    expect(key).toBe('AIza-settings');
  });
});
