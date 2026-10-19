import { describe, expect, it } from 'vitest';

import { FullStorage, MemoryStorage } from '../test/memoryStorage';
import { keysChanged, saveApiKeys, storedKey } from './apiKeys';

describe('a stored API key', () => {
  it('is remembered for the next visit', () => {
    const storage = new MemoryStorage();
    storedKey('aiApiKey', storage).set('sk-saved');
    expect(storage.getItem('aiApiKey')).toBe('sk-saved');
    expect(storedKey('aiApiKey', storage).get()).toBe('sk-saved');
  });

  it('is still used this visit when it cannot be saved, over the one stored before', () => {
    const key = storedKey('aiApiKey', new FullStorage({ aiApiKey: 'sk-old' }));
    expect(key.get()).toBe('sk-old');
    expect(() => key.set('sk-new')).toThrow('quota');
    expect(key.get()).toBe('sk-new');
  });
});

describe('saving keys from Settings', () => {
  const none = { anthropic: '', google: '' };
  const storesOver = (anthropic: Storage, google: Storage) => ({
    anthropic: storedKey('aiApiKey', anthropic),
    google: storedKey('googleApiKey', google),
  });

  it('has nothing to save until a key changes, once trimmed', () => {
    expect(keysChanged({ anthropic: ' sk ', google: '' }, { anthropic: 'sk', google: '' })).toBe(
      false,
    );
    expect(keysChanged({ anthropic: 'sk2', google: '' }, { anthropic: 'sk', google: '' })).toBe(
      true,
    );
  });

  it('saves a trimmed Anthropic key, without reloading', () => {
    const storage = new MemoryStorage();
    const result = saveApiKeys(
      { anthropic: '  sk-ant  ', google: '' },
      none,
      storesOver(storage, storage),
    );
    expect(result).toEqual({
      reload: false,
      saved: { anthropic: 'sk-ant', google: '' },
      error: null,
    });
    expect(storage.getItem('aiApiKey')).toBe('sk-ant');
  });

  it('saves a new Google key and reloads, so every lookup uses it', () => {
    const storage = new MemoryStorage();
    expect(
      saveApiKeys({ anthropic: '', google: 'AIza' }, none, storesOver(storage, storage)),
    ).toMatchObject({ reload: true, error: null });
    expect(storage.getItem('googleApiKey')).toBe('AIza');
  });

  it('keeps the keys for this visit, without reloading, when the browser cannot save them', () => {
    const stores = storesOver(new FullStorage(), new FullStorage());
    const result = saveApiKeys({ anthropic: '', google: 'AIza-unsaved' }, none, stores);
    expect(result).toMatchObject({ reload: false, saved: { google: 'AIza-unsaved' } });
    expect(result.error).toMatch(/^Couldn't save in this browser/);
    expect(stores.google.get()).toBe('AIza-unsaved');
  });

  it('saves a changed Google key even when the unchanged Anthropic key cannot be written', () => {
    const google = new MemoryStorage();
    const saved = { anthropic: 'sk', google: '' };
    const stores = storesOver(new FullStorage(), google);
    const result = saveApiKeys({ anthropic: 'sk', google: 'AIza' }, saved, stores);
    expect(result).toMatchObject({ reload: true, error: null });
    expect(google.getItem('googleApiKey')).toBe('AIza');
  });
});
