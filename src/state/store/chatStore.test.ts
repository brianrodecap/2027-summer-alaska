import { beforeEach, describe, expect, it } from 'vitest';

import type { AskAIConversation } from '../../model/askAI';
import { createLocalStorageChatStore } from './chatStore';

const conversation: AskAIConversation = {
  system: 'instructions + itinerary',
  itineraryHash: 'abc12345',
  apiMessages: [{ role: 'user', content: 'Hi' }],
  messages: [{ role: 'user', text: 'Hi' }],
};

describe('createLocalStorageChatStore', () => {
  beforeEach(() => window.localStorage.clear());

  it('round-trips a conversation and its applied ids per trip', async () => {
    const store = createLocalStorageChatStore();
    await store.save('trip-a', conversation);
    expect(await store.load('trip-a')).toEqual({ conversation, applied: [] });
    await store.saveApplied('trip-a', ['tu_1']);
    expect(await store.load('trip-a')).toEqual({ conversation, applied: ['tu_1'] });
    expect(await store.load('trip-b')).toBeNull();
  });

  it('clears a trip’s conversation and applied ids', async () => {
    const store = createLocalStorageChatStore();
    await store.save('trip-a', conversation);
    await store.saveApplied('trip-a', ['tu_1']);
    await store.clear('trip-a');
    expect(await store.load('trip-a')).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });

  it('starts fresh from corrupt, wrong-shaped, or retired-version saved data', async () => {
    window.localStorage.setItem('itinerary.chat.v2/trip-a', '{not json');
    window.localStorage.setItem('itinerary.chat.v2/trip-b', JSON.stringify({ messages: [] }));
    window.localStorage.setItem('itinerary.chat.v1/trip-c', JSON.stringify(conversation));
    const store = createLocalStorageChatStore();
    expect(await store.load('trip-a')).toBeNull();
    expect(await store.load('trip-b')).toBeNull();
    expect(await store.load('trip-c')).toBeNull();
    // The retired save is dropped, not left taking up space.
    expect(window.localStorage.getItem('itinerary.chat.v1/trip-c')).toBeNull();
  });

  it('keeps working when a save fails (quota)', async () => {
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
      removeItem: () => {},
    } as unknown as Storage;
    await expect(createLocalStorageChatStore(full).save('trip-a', conversation)).resolves.toBe(
      undefined,
    );
  });
});
