// The one place the Anthropic API is called from, via the official SDK, directly from
// the browser with a user-supplied key (see src/config/apiKeys.ts for why this key is
// never hardcoded like the Google key — `dangerouslyAllowBrowser` is that same
// accepted trade-off). Shared by src/model/proposalImport.ts (document
// import) and src/model/askAI.ts (multi-turn chat with tools):
// only the request plumbing every caller needs identically lives here — model,
// refusal fallback, and turning API failures into each caller's own error type.
import type Anthropic from '@anthropic-ai/sdk';
import type {
  BetaContentBlock,
  BetaMessage,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';

import { getAnthropicApiKey } from '../config/apiKeys';
import type { ClientOptions } from './clientOptions';

export const MODEL_ID = 'claude-opus-5-5';

// `fallbacks: 'default'` re-runs a request a safety classifier declined on the model
// Anthropic recommends for that refusal category, server-side, so a false-positive
// decline on an ordinary itinerary question comes back as an answer instead of an error.
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

// `betas` here are any extra ones a caller needs; the fallback beta is always added.
// `model` defaults to MODEL_ID; a caller passes one only to compare models
// (the attachments check's IMPORT_MODEL).
export type MessageRequest = Omit<MessageCreateParamsNonStreaming, 'model' | 'fallbacks'> & {
  model?: string;
};

// The API's own error message (e.g. "invalid x-api-key") rather than the SDK's
// "401 {json}" rendering, since this is shown to the user as-is.
function apiErrorMessage(err: InstanceType<typeof Anthropic.APIError>): string {
  const body = err.error as { error?: { message?: string } } | undefined;
  return body?.error?.message ?? err.message;
}

async function loadClient(apiKey: string, fetch?: typeof globalThis.fetch) {
  // Loaded on first use rather than imported statically: the SDK is ~200 KB, and only
  // a visit that actually uses an AI feature should pay for it (TripsHome's Add-trip-
  // from-a-document reaches this module from the initial bundle).
  const { default: AnthropicClient } = await import('@anthropic-ai/sdk');
  return {
    AnthropicClient,
    client: new AnthropicClient({ apiKey, fetch, dangerouslyAllowBrowser: true }),
  };
}

function withFallback(request: MessageRequest) {
  return {
    ...request,
    model: request.model ?? MODEL_ID,
    betas: [FALLBACK_BETA, ...(request.betas ?? [])],
    fallbacks: 'default' as const,
  };
}

// Thrown (instead of the caller's own error type) when the request was cancelled
// through its AbortSignal, so a deliberate Stop never surfaces as a failure.
export class RequestAbortedError extends Error {}

// Runs the request, then the envelope checks every caller needs (an API or network
// failure, a cancellation, a refusal stop reason). Interpreting `content` is left to
// the caller, since that genuinely differs by call shape.
async function send(
  run: (client: Anthropic) => Promise<BetaMessage>,
  makeError: (message: string) => Error,
  refusalMessage: string,
  { apiKey = getAnthropicApiKey(), fetch }: ClientOptions = {},
): Promise<BetaMessage> {
  if (!apiKey) throw makeError('Add your Anthropic API key in Settings.');
  const { AnthropicClient, client } = await loadClient(apiKey, fetch);
  let message: BetaMessage;
  try {
    message = await run(client);
  } catch (err) {
    if (err instanceof AnthropicClient.APIUserAbortError) throw new RequestAbortedError();
    if (err instanceof AnthropicClient.APIError) throw makeError(apiErrorMessage(err));
    throw err;
  }
  // Only reached if the fallback model declined too.
  if (message.stop_reason === 'refusal') throw makeError(refusalMessage);
  return message;
}

export function createMessage(
  request: MessageRequest,
  makeError: (message: string) => Error,
  refusalMessage: string,
  options?: ClientOptions,
): Promise<BetaMessage> {
  return send(
    (client) => client.beta.messages.create(withFallback(request)),
    makeError,
    refusalMessage,
    options,
  );
}

export interface StreamHandlers {
  onText?: (delta: string) => void;
  // Thinking-block text as it streams — with `display: 'updates'` that's the model's
  // short progress notes between tool calls, never its raw reasoning.
  onThinking?: (delta: string) => void;
}

// Same as createMessage, but streamed: text arrives through `handlers` as it's
// generated, and the promise resolves with the complete message once it's done.
export function streamMessage(
  request: MessageRequest,
  makeError: (message: string) => Error,
  refusalMessage: string,
  handlers: StreamHandlers,
  signal?: AbortSignal,
  options?: ClientOptions,
): Promise<BetaMessage> {
  return send(
    (client) => {
      const stream = client.beta.messages.stream(withFallback(request), { signal });
      if (handlers.onText) stream.on('text', handlers.onText);
      if (handlers.onThinking) stream.on('thinking', handlers.onThinking);
      return stream.finalMessage();
    },
    makeError,
    refusalMessage,
    options,
  );
}

// What a caller sends its requests through, with its own errors already bound;
// tests pass stubs.
export type SendMessage = (request: MessageRequest) => Promise<BetaMessage>;
export type StreamMessage = (
  request: MessageRequest,
  handlers: StreamHandlers,
  signal?: AbortSignal,
) => Promise<BetaMessage>;

// Text blocks only — with thinking always on, a response can also carry `thinking`
// blocks, which are never shown as the answer.
export function responseText(content: BetaContentBlock[]): string {
  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}
