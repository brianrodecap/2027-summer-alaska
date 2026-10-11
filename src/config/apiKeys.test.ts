import { afterEach, describe, expect, it, vi } from 'vitest';

import { getAnthropicApiKey, setAnthropicApiKey } from './apiKeys';

describe('the Anthropic key', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is remembered for the next visit', () => {
    setAnthropicApiKey('sk-saved');
    expect(localStorage.getItem('aiApiKey')).toBe('sk-saved');
    expect(getAnthropicApiKey()).toBe('sk-saved');
  });

  it('is still used this visit when it cannot be saved, over the one stored before', () => {
    localStorage.setItem('aiApiKey', 'sk-old');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => setAnthropicApiKey('sk-new')).toThrow('QuotaExceededError');
    expect(getAnthropicApiKey()).toBe('sk-new');
  });
});
