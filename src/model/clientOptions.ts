// What an edge client sends its requests with: Settings' key and the browser's
// fetch by default; tests pass their own.
export interface ClientOptions {
  apiKey?: string;
  fetch?: typeof globalThis.fetch;
}
