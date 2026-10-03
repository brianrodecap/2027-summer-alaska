import { readJson, safeRemoveItem, safeSetItem } from '../../config/safeStorage';
import type { AskAIConversation } from '../../model/askAI';

// Where each trip's Ask AI conversation is kept between visits. Async, like TripStore,
// so a real backend can replace the localStorage version without callers changing.
// Unlike trip edits, a lost conversation costs nothing but context, so failures here
// are best-effort: an unreadable save starts a fresh conversation, and a failed write
// leaves the in-memory conversation working for the rest of the visit.
//
// Which proposals have been applied (by AskAIProposal id) is stored on its own, not
// inside the conversation: the conversation is append-only API history, while applied
// state changes whenever an Apply is clicked — even mid-turn.
export interface StoredChat {
  conversation: AskAIConversation;
  applied: string[];
}

export interface ChatStore {
  load(slug: string): Promise<StoredChat | null>;
  save(slug: string, conversation: AskAIConversation): Promise<void>;
  saveApplied(slug: string, applied: string[]): Promise<void>;
  clear(slug: string): Promise<void>;
}

// Bump the version if AskAIConversation's shape changes incompatibly; an older save is
// then dropped and the trip starts a fresh conversation.
const keyFor = (slug: string) => `itinerary.chat.v2/${slug}`;
const appliedKeyFor = (slug: string) => `itinerary.chat.v2/${slug}/applied`;
const RETIRED_KEYS = (slug: string) => [`itinerary.chat.v1/${slug}`];

function isConversation(value: unknown): value is AskAIConversation {
  const c = value as AskAIConversation | null;
  return (
    !!c &&
    typeof c.system === 'string' &&
    typeof c.itineraryHash === 'string' &&
    Array.isArray(c.apiMessages) &&
    Array.isArray(c.messages)
  );
}

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === 'string');

export function createLocalStorageChatStore(storage: Storage = window.localStorage): ChatStore {
  return {
    load: async (slug) => {
      RETIRED_KEYS(slug).forEach((key) => safeRemoveItem(key, storage));
      const conversation = readJson(keyFor(slug), isConversation, null, storage);
      if (!conversation) return null;
      return { conversation, applied: readJson(appliedKeyFor(slug), isStringList, [], storage) };
    },
    // Not persisted on failure (quota, blocked storage); it still works this visit.
    save: async (slug, conversation) =>
      safeSetItem(keyFor(slug), JSON.stringify(conversation), storage),
    saveApplied: async (slug, applied) =>
      safeSetItem(appliedKeyFor(slug), JSON.stringify(applied), storage),
    clear: async (slug) => {
      safeRemoveItem(keyFor(slug), storage);
      safeRemoveItem(appliedKeyFor(slug), storage);
    },
  };
}
