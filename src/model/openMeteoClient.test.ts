import { describe, expect, it } from 'vitest';

import { createOpenMeteoClient } from './openMeteoClient';

// A client on a fake clock: `sleep` advances it instead of waiting, and each
// request gets the next of `bodies` back.
function fakeClient(bodies: unknown[], start = Date.UTC(2027, 6, 1, 12, 30)) {
  let clock = start;
  const urls: string[] = [];
  const slept: number[] = [];
  const client = createOpenMeteoClient({
    fetch: async (url) => {
      urls.push(String(url));
      return new Response(JSON.stringify(bodies.shift() ?? {}), { status: 200 });
    },
    now: () => clock,
    sleep: async (ms) => {
      slept.push(ms);
      clock += ms;
    },
  });
  return { ...client, urls, slept, advance: (ms: number) => (clock += ms) };
}

describe('openMeteoClient', () => {
  it('retries a per-minute limit after backing off', async () => {
    const client = fakeClient([
      { error: true, reason: 'Minutely API request limit exceeded.' },
      { ok: 1 },
    ]);
    await expect(client.fetchOpenMeteoJson('https://example.test/a')).resolves.toEqual({ ok: 1 });
    expect(client.urls).toHaveLength(2);
    expect(client.slept).toContain(1000);
  });

  it('stops asking until the hour turns once the hourly quota is spent', async () => {
    const client = fakeClient([
      { error: true, reason: 'Hourly API request limit exceeded.' },
      { ok: 2 },
    ]);
    await expect(client.fetchOpenMeteoJson('https://example.test/a')).resolves.toBeNull();
    client.advance(20 * 60 * 1000);
    await expect(client.fetchOpenMeteoJson('https://example.test/b')).resolves.toBeNull();
    expect(client.urls).toHaveLength(1);
    // 12:30 + 30 min to the hour + a minute's slack.
    client.advance(11 * 60 * 1000 - 1);
    await expect(client.fetchOpenMeteoJson('https://example.test/c')).resolves.toBeNull();
    expect(client.urls).toHaveLength(1);
    client.advance(1);
    await expect(client.fetchOpenMeteoJson('https://example.test/c')).resolves.toEqual({ ok: 2 });
  });
});
