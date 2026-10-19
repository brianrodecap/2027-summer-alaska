// Loaded with the test file rather than on a test's first request, so loading the
// SDK never counts against a test's timeout.
import '@anthropic-ai/sdk';

import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';

import { MODEL_ID } from '../model/anthropicClient';
import type { ClientOptions } from '../model/clientOptions';

// An Anthropic API reply carrying `content`, for a stubbed message client or API.
export function fakeMessage(
  content: unknown[],
  stopReason = 'end_turn',
  overrides: Partial<Record<keyof BetaMessage, unknown>> = {},
): BetaMessage {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: MODEL_ID,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
    ...overrides,
  } as unknown as BetaMessage;
}

type Block =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown };

// `message` as the API streams it: server-sent events, one delta per block.
export function streamedBody(message: BetaMessage): string {
  const events: unknown[] = [
    { type: 'message_start', message: { ...message, content: [], stop_reason: null } },
  ];
  (message.content as unknown as Block[]).forEach((block, index) => {
    if (block.type === 'text') {
      events.push({
        type: 'content_block_start',
        index,
        content_block: { type: 'text', text: '' },
      });
      events.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'text_delta', text: block.text },
      });
    } else if (block.type === 'thinking') {
      events.push({
        type: 'content_block_start',
        index,
        content_block: { type: 'thinking', thinking: '', signature: '' },
      });
      events.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'thinking_delta', thinking: block.thinking },
      });
      events.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'signature_delta', signature: block.signature },
      });
    } else {
      events.push({
        type: 'content_block_start',
        index,
        content_block: { ...block, input: {} },
      });
      events.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) },
      });
    }
    events.push({ type: 'content_block_stop', index });
  });
  events.push({
    type: 'message_delta',
    delta: { stop_reason: message.stop_reason, stop_sequence: null },
    usage: { output_tokens: 10 },
  });
  events.push({ type: 'message_stop' });
  return events
    .map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`)
    .join('');
}

export interface SentRequest {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

// Client options whose fetch answers every request with `response`, plus each
// request it was given. A string body is sent as a server-sent event stream.
export function fakeAnthropic(
  response: { status?: number; body: unknown },
  apiKey = 'sk-test',
): { sent: SentRequest[]; options: ClientOptions } {
  const sent: SentRequest[] = [];
  const fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
    sent.push({
      url: String(url),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    });
    const streamed = typeof response.body === 'string';
    return new Response(streamed ? (response.body as string) : JSON.stringify(response.body), {
      status: response.status ?? 200,
      headers: { 'content-type': streamed ? 'text/event-stream' : 'application/json' },
    });
  };
  return { sent, options: { apiKey, fetch } };
}
