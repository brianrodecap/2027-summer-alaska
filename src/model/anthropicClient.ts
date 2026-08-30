// Minimal client for the Anthropic Messages API, called directly from the browser with a
// user-supplied key (see src/config/aiKey.ts for why this key is never hardcoded like
// config/places.ts's Google key). Shared by src/model/documentImport.ts (forced
// single-tool document extraction) and src/model/askAI.ts (multi-turn chat with an
// optional tool) — both hit the same endpoint/key/model, just with different request
// shapes, so only the truly API-generic pieces (not anything extraction- or
// chat-specific) live here.
export const MODEL_ID = 'claude-sonnet-5';
export const ANTHROPIC_VERSION = '2023-06-01';
export const API_URL = 'https://api.anthropic.com/v1/messages';

export interface AnthropicContentBlock {
  type: string;
  name?: string;
  input?: unknown;
  text?: string;
}

export interface AnthropicResponse {
  content: AnthropicContentBlock[];
  stop_reason: string;
  error?: { message?: string };
}

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: unknown;
}

// Does the fetch, then the response envelope checks every caller needs
// (network/HTTP failure, unreadable body, a refusal stop reason) — leaves
// interpreting `content` (finding a tool_use, reading text blocks) to the
// caller, since that part genuinely differs by call shape.
export async function callAnthropicMessages(
  requestBody: Record<string, unknown>,
  apiKey: string,
  makeError: (message: string) => Error,
  refusalMessage: string,
): Promise<AnthropicResponse> {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: MODEL_ID, ...requestBody }),
  });

  const body = (await res.json().catch(() => null)) as AnthropicResponse | null;
  if (!res.ok) {
    throw makeError(body?.error?.message ?? `Claude API error ${res.status}`);
  }
  if (!body) {
    throw makeError('Claude API returned an unreadable response.');
  }
  if (body.stop_reason === 'refusal') {
    throw makeError(refusalMessage);
  }
  return body;
}

// The one part of "interpreting `content`" every caller needs identically:
// picking out a named tool's call among the response's content blocks.
export function findToolUse(
  content: AnthropicContentBlock[],
  toolName: string,
): AnthropicContentBlock | undefined {
  return content.find((block) => block.type === 'tool_use' && block.name === toolName);
}
