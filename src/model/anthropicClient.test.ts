import { describe, expect, it } from 'vitest';

import { type Block, fakeAnthropic, fakeMessage, streamedBody } from '../test/fakeAnthropic';
import { createMessage, RequestAbortedError, streamMessage } from './anthropicClient';

// The one adapter over the SDK, so its tests run through it: each hands the SDK a
// stub fetch, and nothing reaches the real API. The assertions are on the request
// the SDK sends and on how each response shape is read back.

const hello = { max_tokens: 100, messages: [{ role: 'user' as const, content: 'hello' }] };
const makeError = (message: string) => new Error(message);

describe('createMessage', () => {
  it('sends the model, the refusal fallback, and the user key', async () => {
    const { sent, options } = fakeAnthropic({ body: fakeMessage([{ type: 'text', text: 'hi' }]) });
    await createMessage(hello, makeError, 'declined', options);
    const [request] = sent;
    expect(request.url).toContain('/v1/messages');
    expect(request.body).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default' });
    expect(request.headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(request.headers.get('x-api-key')).toBe('sk-test');
  });

  it("turns an API error into the caller's error with the API's own message", async () => {
    const { options } = fakeAnthropic(
      {
        status: 401,
        body: {
          type: 'error',
          error: { type: 'authentication_error', message: 'invalid x-api-key' },
        },
      },
      'bad',
    );
    await expect(createMessage(hello, makeError, 'declined', options)).rejects.toThrow(
      'invalid x-api-key',
    );
  });

  it('asks for a key, without calling the API, when none is set', async () => {
    const { sent, options } = fakeAnthropic(
      { body: fakeMessage([{ type: 'text', text: 'hi' }]) },
      '',
    );
    await expect(createMessage(hello, makeError, 'declined', options)).rejects.toThrow(
      'Add your Anthropic API key in Settings.',
    );
    expect(sent).toHaveLength(0);
  });

  it('reports a refusal that survived the fallback', async () => {
    const { options } = fakeAnthropic({ body: fakeMessage([], 'refusal') });
    await expect(createMessage(hello, makeError, 'declined', options)).rejects.toThrow('declined');
  });
});

describe('streamMessage', () => {
  const streamed = (content: Block[], stopReason = 'end_turn') =>
    fakeAnthropic({ body: streamedBody(fakeMessage(content, stopReason)) });

  it('hands over text and thinking as they stream, and the whole message at the end', async () => {
    const { options } = streamed([
      { type: 'thinking', thinking: 'Checking the 14th.', signature: 'sig' },
      { type: 'text', text: 'Bring rain gear.' },
    ]);
    const text: string[] = [];
    const thinking: string[] = [];
    const message = await streamMessage(
      hello,
      makeError,
      'declined',
      { onText: (t) => text.push(t), onThinking: (t) => thinking.push(t) },
      undefined,
      options,
    );
    expect(text.join('')).toBe('Bring rain gear.');
    expect(thinking.join('')).toBe('Checking the 14th.');
    // The thinking block comes back with its signature, to be passed back as is.
    expect(message.content[0]).toMatchObject({
      type: 'thinking',
      thinking: 'Checking the 14th.',
      signature: 'sig',
    });
  });

  it('reports a refusal that survived the fallback', async () => {
    const { options } = streamed([], 'refusal');
    await expect(
      streamMessage(hello, makeError, 'declined', {}, undefined, options),
    ).rejects.toThrow('declined');
  });

  it('turns a cancelled request into RequestAbortedError, not a failure', async () => {
    const { options } = streamed([{ type: 'text', text: 'hi' }]);
    const controller = new AbortController();
    controller.abort();
    await expect(
      streamMessage(hello, makeError, 'declined', {}, controller.signal, options),
    ).rejects.toBeInstanceOf(RequestAbortedError);
  });
});
