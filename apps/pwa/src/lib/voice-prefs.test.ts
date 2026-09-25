// C2 — voice-prefs localStorage helper.

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  DEFAULT_VOICE_PREFS,
  SPEAKING_MULTIPLIER_MIN,
  SPEAKING_MULTIPLIER_MAX,
  loadVoicePrefs,
  saveVoicePrefs,
  resetVoicePrefs,
} from './voice-prefs';

const STORAGE_KEY = 'monad.voice.prefs';

// Minimal localStorage stub (Bun runtime doesn't ship one by default
// in this test harness).
function installLocalStorageStub(): { restore: () => void } {
  const store = new Map<string, string>();
  const stub = {
    getItem(key: string): string | null { return store.has(key) ? store.get(key)! : null; },
    setItem(key: string, value: string): void { store.set(key, value); },
    removeItem(key: string): void { store.delete(key); },
    clear(): void { store.clear(); },
    key(i: number): string | null { return Array.from(store.keys())[i] ?? null; },
    get length(): number { return store.size; },
  };
  const prevWindow = (globalThis as { window?: unknown }).window;
  const prevLs = (globalThis as { localStorage?: unknown }).localStorage;
  (globalThis as { window?: unknown }).window = globalThis;
  (globalThis as { localStorage?: unknown }).localStorage = stub;
  return {
    restore() {
      if (prevWindow === undefined) delete (globalThis as { window?: unknown }).window;
      else (globalThis as { window?: unknown }).window = prevWindow;
      if (prevLs === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
      else (globalThis as { localStorage?: unknown }).localStorage = prevLs;
    },
  };
}

let stubHandle: { restore: () => void };

beforeEach(() => {
  stubHandle = installLocalStorageStub();
});

afterEach(() => {
  stubHandle.restore();
});

describe('voice-prefs · loadVoicePrefs', () => {
  test('missing key → defaults', () => {
    expect(loadVoicePrefs()).toEqual(DEFAULT_VOICE_PREFS);
  });

  test('valid stored value → preserved', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ speakingThresholdMultiplier: 2.5 }));
    expect(loadVoicePrefs().speakingThresholdMultiplier).toBe(2.5);
  });

  test('out-of-range stored value → clamped on read', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ speakingThresholdMultiplier: 10.0 }));
    expect(loadVoicePrefs().speakingThresholdMultiplier).toBe(SPEAKING_MULTIPLIER_MAX);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ speakingThresholdMultiplier: 0.1 }));
    expect(loadVoicePrefs().speakingThresholdMultiplier).toBe(SPEAKING_MULTIPLIER_MIN);
  });

  test('non-finite stored value → defaults (no NaN poisoning)', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ speakingThresholdMultiplier: Number.NaN }));
    expect(loadVoicePrefs().speakingThresholdMultiplier).toBe(DEFAULT_VOICE_PREFS.speakingThresholdMultiplier);
  });

  test('malformed JSON → defaults (no throw)', () => {
    localStorage.setItem(STORAGE_KEY, '{this-is-not-json');
    expect(loadVoicePrefs()).toEqual(DEFAULT_VOICE_PREFS);
  });

  test('non-number type → defaults', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ speakingThresholdMultiplier: 'two' }));
    expect(loadVoicePrefs()).toEqual(DEFAULT_VOICE_PREFS);
  });
});

describe('voice-prefs · saveVoicePrefs', () => {
  test('persists patched value', () => {
    saveVoicePrefs({ speakingThresholdMultiplier: 3.0 });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ speakingThresholdMultiplier: 3.0 });
  });

  test('clamps on save', () => {
    saveVoicePrefs({ speakingThresholdMultiplier: 99 });
    expect(loadVoicePrefs().speakingThresholdMultiplier).toBe(SPEAKING_MULTIPLIER_MAX);
  });

  test('partial patch retains other fields (forward-compat)', () => {
    // Today only one field exists, but the merge semantics matter for
    // future fields (e.g. cross-device sync toggle).
    saveVoicePrefs({ speakingThresholdMultiplier: 2.5 });
    saveVoicePrefs({});
    expect(loadVoicePrefs().speakingThresholdMultiplier).toBe(2.5);
  });
});

describe('voice-prefs · resetVoicePrefs', () => {
  test('removes the stored entry and returns defaults', () => {
    saveVoicePrefs({ speakingThresholdMultiplier: 4.0 });
    resetVoicePrefs();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(loadVoicePrefs()).toEqual(DEFAULT_VOICE_PREFS);
  });
});
