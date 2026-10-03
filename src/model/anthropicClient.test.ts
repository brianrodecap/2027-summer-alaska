import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMessage } from './anthropicClient';
import { extractEntityFromDocument, extractTripEntitiesFromDocument } from './documentImport';

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

// With thinking always on, a real response can lead with a thinking block whose text
// is empty under the default display — every reader must skip it.
const THINKING = { type: 'thinking', thinking: '', signature: 'sig' };

const makeError = (message: string) => new Error(message);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createMessage', () => {
  it('sends the model, the refusal fallback, and the user key', async () => {
    const calls = stubApi(200, reply([{ type: 'text', text: 'hi' }]));
    await createMessage(
      { max_tokens: 100, messages: [{ role: 'user', content: 'hello' }] },
      'sk-test',
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
    stubApi(401, {
      type: 'error',
      error: { type: 'authentication_error', message: 'invalid x-api-key' },
    });
    await expect(
      createMessage(
        { max_tokens: 100, messages: [{ role: 'user', content: 'hello' }] },
        'bad',
        makeError,
        'declined',
      ),
    ).rejects.toThrow('invalid x-api-key');
  });

  it('reports a refusal that survived the fallback', async () => {
    stubApi(200, reply([], 'refusal'));
    await expect(
      createMessage(
        { max_tokens: 100, messages: [{ role: 'user', content: 'hello' }] },
        'sk-test',
        makeError,
        'declined',
      ),
    ).rejects.toThrow('declined');
  });
});

// Structured outputs reject any object schema without additionalProperties: false, so
// check every object the import schemas actually send.
function objectsMissingClosedFlag(schema: unknown, path = '$'): string[] {
  if (!schema || typeof schema !== 'object') return [];
  const node = schema as Record<string, unknown>;
  const own =
    node.type === 'object' && node.additionalProperties !== false ? [path] : ([] as string[]);
  const children = [
    ...Object.entries((node.properties as Record<string, unknown>) ?? {}).map(
      ([key, child]) => [`${path}.${key}`, child] as const,
    ),
    ...(node.items ? [[`${path}[]`, node.items] as const] : []),
  ];
  return [
    ...own,
    ...children.flatMap(([childPath, child]) => objectsMissingClosedFlag(child, childPath)),
  ];
}

describe('document import request', () => {
  it('flags an unclosed object at any depth (guards the checks below)', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: { list: { type: 'array', items: { type: 'object', properties: {} } } },
    };
    expect(objectsMissingClosedFlag(schema)).toEqual(['$.list[]']);
  });

  const pdf = () => new File(['%PDF-1.4 synthetic'], 'booking.pdf', { type: 'application/pdf' });

  it('asks for structured output instead of a forced tool call, and parses the JSON reply', async () => {
    const calls = stubApi(
      200,
      reply([THINKING, { type: 'text', text: '{"kind":"stay","lodgingName":"Test Lodge"}' }]),
    );
    const fields = await extractEntityFromDocument(pdf(), 'sk-test');

    const { body } = calls[0];
    expect(body.tool_choice).toBeUndefined();
    expect(body.tools).toBeUndefined();
    expect(body.thinking).toBeUndefined();
    const format = (body.output_config as { format: { type: string; schema: unknown } }).format;
    expect(format.type).toBe('json_schema');
    expect(objectsMissingClosedFlag(format.schema)).toEqual([]);
    expect(fields).toEqual({ kind: 'stay', lodgingName: 'Test Lodge' });
  });

  it('closes every object in the whole-trip schema too', async () => {
    const calls = stubApi(
      200,
      reply([{ type: 'text', text: '{"tripName":"Test","entities":[{"kind":"transit"}]}' }]),
    );
    const result = await extractTripEntitiesFromDocument(pdf(), 'sk-test');

    const format = (calls[0].body.output_config as { format: { schema: unknown } }).format;
    expect(objectsMissingClosedFlag(format.schema)).toEqual([]);
    expect(result.entities).toEqual([{ kind: 'transit' }]);
  });

  it('reports a reply cut off at max_tokens instead of parsing partial JSON', async () => {
    stubApi(200, reply([{ type: 'text', text: '{"kind":"st' }], 'max_tokens'));
    await expect(extractEntityFromDocument(pdf(), 'sk-test')).rejects.toThrow(
      'more detail than fits',
    );
  });
});
