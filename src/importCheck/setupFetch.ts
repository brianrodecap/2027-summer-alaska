import { setAnthropicApiKey, setGoogleApiKey } from '../config/apiKeys';

// The import reads its keys where Settings keeps them (src/config/apiKeys.ts);
// here they come from ANTHROPIC_API_KEY and GOOGLE_API_KEY.
setAnthropicApiKey(process.env.ANTHROPIC_API_KEY ?? '');
setGoogleApiKey(process.env.GOOGLE_API_KEY ?? '');

// The Google key is restricted to the site's own referrers
// (see src/config/apiKeys.ts), which a browser sends on its own. Under the
// attachments check there's no page, so Google calls carry the local dev
// server's address as their referrer, the same as running the import from
// `npm run dev` would.
const DEV_REFERRER = 'http://localhost:5173/2027-summer-alaska/';
const nodeFetch = globalThis.fetch;

globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  if (!url.startsWith('https://places.googleapis.com/')) return nodeFetch(input, init);
  const headers = new Headers(init?.headers);
  headers.set('Referer', DEV_REFERRER);
  return nodeFetch(input, { ...init, headers });
};
