import { describe, expect, it } from 'vitest';

import { FullStorage, MemoryStorage } from '../test/memoryStorage';
import { type KeyName, keysChanged, saveApiKeys, storedKey } from './apiKeys';

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
  const none = { anthropic: '', google: '', airlabs: '', aviationstack: '' };
  // Each key's store over its own storage; keys not named get working storage.
  const storesOver = (storage: Partial<Record<KeyName, Storage>> = {}) => ({
    anthropic: storedKey('aiApiKey', storage.anthropic ?? new MemoryStorage()),
    google: storedKey('googleApiKey', storage.google ?? new MemoryStorage()),
    airlabs: storedKey('airlabsApiKey', storage.airlabs ?? new MemoryStorage()),
    aviationstack: storedKey('aviationstackApiKey', storage.aviationstack ?? new MemoryStorage()),
  });

  it('has nothing to save until a key changes, once trimmed', () => {
    expect(keysChanged({ ...none, anthropic: ' sk ' }, { ...none, anthropic: 'sk' })).toBe(false);
    expect(keysChanged({ ...none, anthropic: 'sk2' }, { ...none, anthropic: 'sk' })).toBe(true);
  });

  it('saves a trimmed Anthropic key, without reloading', () => {
    const storage = new MemoryStorage();
    const result = saveApiKeys(
      { ...none, anthropic: '  sk-ant  ' },
      none,
      storesOver({ anthropic: storage, google: storage }),
    );
    expect(result).toEqual({
      reload: false,
      saved: { ...none, anthropic: 'sk-ant' },
      error: null,
    });
    expect(storage.getItem('aiApiKey')).toBe('sk-ant');
  });

  it('saves a new Google key and reloads, so every lookup uses it', () => {
    const storage = new MemoryStorage();
    expect(
      saveApiKeys(
        { ...none, google: 'AIza' },
        none,
        storesOver({ anthropic: storage, google: storage }),
      ),
    ).toMatchObject({ reload: true, error: null });
    expect(storage.getItem('googleApiKey')).toBe('AIza');
  });

  it('keeps the keys for this visit, without reloading, when the browser cannot save them', () => {
    const stores = storesOver({ anthropic: new FullStorage(), google: new FullStorage() });
    const result = saveApiKeys({ ...none, google: 'AIza-unsaved' }, none, stores);
    expect(result).toMatchObject({ reload: false, saved: { google: 'AIza-unsaved' } });
    expect(result.error).toMatch(/^Couldn't save in this browser/);
    expect(stores.google.get()).toBe('AIza-unsaved');
  });

  it('saves a changed Google key even when the unchanged Anthropic key cannot be written', () => {
    const google = new MemoryStorage();
    const saved = { ...none, anthropic: 'sk' };
    const stores = storesOver({ anthropic: new FullStorage(), google });
    const result = saveApiKeys({ ...none, anthropic: 'sk', google: 'AIza' }, saved, stores);
    expect(result).toMatchObject({ reload: true, error: null });
    expect(google.getItem('googleApiKey')).toBe('AIza');
  });

  it('saves an AviationStack key without reloading, since each lookup reads it', () => {
    const storage = new MemoryStorage();
    const result = saveApiKeys(
      { ...none, aviationstack: ' as-key ' },
      none,
      storesOver({ aviationstack: storage }),
    );
    expect(result).toEqual({
      reload: false,
      saved: { ...none, aviationstack: 'as-key' },
      error: null,
    });
    expect(storage.getItem('aviationstackApiKey')).toBe('as-key');
  });

  it('holds off the Google reload while an AviationStack key is unsaved', () => {
    const stores = storesOver({ aviationstack: new FullStorage() });
    const result = saveApiKeys({ ...none, google: 'AIza', aviationstack: 'as-key' }, none, stores);
    expect(result.reload).toBe(false);
    expect(result.error).toContain('The AviationStack key works only until you leave.');
    expect(result.error).toContain('Reload the page to start using the new Google key.');
    expect(stores.aviationstack.get()).toBe('as-key');
  });

  it('names every per-request key it could not save', () => {
    const stores = storesOver({ anthropic: new FullStorage(), aviationstack: new FullStorage() });
    const result = saveApiKeys({ ...none, anthropic: 'sk', aviationstack: 'as-key' }, none, stores);
    expect(result.error).toContain(
      'The Anthropic and AviationStack keys work only until you leave.',
    );
    expect(result.reload).toBe(false);
    expect([stores.anthropic.get(), stores.aviationstack.get()]).toEqual(['sk', 'as-key']);
  });
});
