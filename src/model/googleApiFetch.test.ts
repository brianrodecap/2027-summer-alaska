import { afterEach, describe, expect, it, vi } from 'vitest';

import { setGoogleApiKey } from '../config/apiKeys';
import { googleApiFetch } from './googleApiFetch';

afterEach(() => vi.unstubAllGlobals());

describe('googleApiFetch', () => {
  it('sends the Google key from Settings', async () => {
    setGoogleApiKey('AIza-test');
    const fetch = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await expect(googleApiFetch('Places API', 'https://example.test', 'id')).resolves.toEqual({
      ok: true,
    });
    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)['X-Goog-Api-Key']).toBe('AIza-test');
  });

  it('asks for a key, without calling Google, when none is set', async () => {
    setGoogleApiKey('');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(googleApiFetch('Places API', 'https://example.test', 'id')).rejects.toThrow(
      'Add your Google API key in Settings.',
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
