import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setAnthropicApiKey } from '../config/apiKeys';
import { createMessage } from './anthropicClient';

// Every test here stubs the global fetch the SDK calls, so nothing reaches the real
// API — the assertions are on the exact request each feature builds and on how each
// response shape is read back.

interface Captured {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

function stubApi(status: number, responseBody: unknown): Captured[] {
  const calls: Captured[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        url: String(url),
        headers: new Headers(init.headers),
        body: JSON.parse(String(init.body)),
      });
      return new Response(JSON.stringify(responseBody), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

function reply(content: unknown[], stopReason = 'end_turn') {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

const makeError = (message: string) => new Error(message);

beforeEach(() => setAnthropicApiKey('sk-test'));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createMessage', () => {
  it('sends the model, the refusal fallback, and the user key', async () => {
    const calls = stubApi(200, reply([{ type: 'text', text: 'hi' }]));
    await createMessage(
      { max_tokens: 100, messages: [{ role: 'user', content: 'hello' }] },
      makeError,
      'declined',
    );
    const [call] = calls;
    expect(call.url).toContain('/v1/messages');
    expect(call.body).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default' });
    expect(call.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(call.headers.get('x-api-key')).toBe('sk-test');
  });

  it("turns an API error into the caller's error with the API's own message", async () => {
    setAnthropicApiKey('bad');
    stubApi(401, {
      type: 'error',
      error: { type: 'authentication_error', message: 'invalid x-api-key' },
    });
    await expect(
      createMessage(
        { max_tokens: 100, messages: [{ role: 'user', content: 'hello' }] },
        makeError,
        'declined',
      ),
    ).rejects.toThrow('invalid x-api-key');
  });

  it('asks for a key, without calling the API, when none is set', async () => {
    setAnthropicApiKey('');
    const calls = stubApi(200, reply([{ type: 'text', text: 'hi' }]));
    await expect(
      createMessage(
        { max_tokens: 100, messages: [{ role: 'user', content: 'hello' }] },
        makeError,
        'declined',
      ),
    ).rejects.toThrow('Add your Anthropic API key in Settings.');
    expect(calls).toHaveLength(0);
  });

  it('reports a refusal that survived the fallback', async () => {
    stubApi(200, reply([], 'refusal'));
    await expect(
      createMessage(
        { max_tokens: 100, messages: [{ role: 'user', content: 'hello' }] },
        makeError,
        'declined',
      ),
    ).rejects.toThrow('declined');
  });
});
