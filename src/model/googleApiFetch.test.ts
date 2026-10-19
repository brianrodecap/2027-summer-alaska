import { describe, expect, it } from 'vitest';

import { googleApiFetch } from './googleApiFetch';

// A fetch that answers `{"ok":true}` and records each request it was given.
function okFetch() {
  const sent: RequestInit[] = [];
  const fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
    sent.push(init ?? {});
    return new Response('{"ok":true}', { status: 200 });
  };
  return { sent, fetch };
}

describe('googleApiFetch', () => {
  it('sends the Google key', async () => {
    const { sent, fetch } = okFetch();
    await expect(
      googleApiFetch('Places API', 'https://example.test', 'id', {
        apiKey: 'AIza-test',
        fetch,
      }),
    ).resolves.toEqual({ ok: true });
    expect((sent[0].headers as Record<string, string>)['X-Goog-Api-Key']).toBe('AIza-test');
  });

  it('asks for a key, without calling Google, when none is set', async () => {
    const { sent, fetch } = okFetch();
    await expect(
      googleApiFetch('Places API', 'https://example.test', 'id', { apiKey: '', fetch }),
    ).rejects.toThrow('Add your Google API key in Settings.');
    expect(sent).toHaveLength(0);
  });
});
