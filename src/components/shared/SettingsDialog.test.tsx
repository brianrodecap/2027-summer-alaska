import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { getAnthropicApiKey, getGoogleApiKey } from '../../config/apiKeys';
import { ThemePreferenceProvider } from '../../state/ThemePreferenceProvider';
import { SettingsDialog } from './SettingsDialog';

const reload = vi.fn();
const realLocation = window.location;

beforeAll(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...realLocation, reload },
  });
});

afterAll(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
});

afterEach(() => {
  cleanup();
  reload.mockClear();
  vi.restoreAllMocks();
});

function openSettings() {
  render(
    <ThemePreferenceProvider>
      <SettingsDialog open onClose={() => {}} />
    </ThemePreferenceProvider>,
  );
}

function enter(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('Settings API keys', () => {
  it('saves an Anthropic key for this browser, without reloading', () => {
    openSettings();
    enter('Anthropic API key', '  sk-ant  ');
    fireEvent.click(screen.getByRole('button', { name: 'Save keys' }));
    expect(getAnthropicApiKey()).toBe('sk-ant');
    expect(localStorage.getItem('aiApiKey')).toBe('sk-ant');
    expect(reload).not.toHaveBeenCalled();
  });

  it('saves a new Google key and reloads, so every lookup uses it', () => {
    openSettings();
    enter('Google API key', 'AIza-test');
    fireEvent.click(screen.getByRole('button', { name: 'Save keys' }));
    expect(getGoogleApiKey()).toBe('AIza-test');
    expect(localStorage.getItem('googleApiKey')).toBe('AIza-test');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('keeps the keys for this visit, without reloading, when the browser cannot save them', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    openSettings();
    enter('Google API key', 'AIza-unsaved');
    fireEvent.click(screen.getByRole('button', { name: 'Save keys' }));
    expect(screen.getByText(/Couldn't save in this browser/)).toBeInTheDocument();
    expect(getGoogleApiKey()).toBe('AIza-unsaved');
    expect(reload).not.toHaveBeenCalled();
  });

  it('saves a changed Google key even when the unchanged Anthropic key cannot be written', () => {
    const write = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === 'aiApiKey') throw new Error('QuotaExceededError');
      write.call(this, key, value);
    });
    openSettings();
    enter('Google API key', 'AIza-only-this');
    fireEvent.click(screen.getByRole('button', { name: 'Save keys' }));
    expect(localStorage.getItem('googleApiKey')).toBe('AIza-only-this');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('has nothing to save until a key changes', () => {
    openSettings();
    expect(screen.getByRole('button', { name: 'Save keys' })).toBeDisabled();
  });
});
