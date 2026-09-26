// Phase B — OCR prefs storage contract.
//
// Mock pattern matches `migrate-base-url.test.ts` (PWA bun:test runs
// in node context so window + localStorage need explicit fixtures).

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  loadOcrPrefs,
  saveOcrPrefs,
  resetOcrPrefs,
  DEFAULT_OCR_PREFS,
} from './ocr-prefs';

declare const globalThis: {
  window?: unknown;
  localStorage?: Storage;
};

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  key(idx: number): string | null { return Array.from(this.map.keys())[idx] ?? null; }
  removeItem(key: string): void { this.map.delete(key); }
  setItem(key: string, value: string): void { this.map.set(key, value); }
}

describe('ocr-prefs', () => {
  let prevWindow: unknown;
  let prevStorage: Storage | undefined;

  beforeEach(() => {
    prevWindow = globalThis.window;
    prevStorage = globalThis.localStorage;
    globalThis.window = {};
    globalThis.localStorage = new MemoryStorage();
  });

  afterEach(() => {
    globalThis.window = prevWindow as never;
    if (prevStorage) globalThis.localStorage = prevStorage;
    else delete globalThis.localStorage;
  });

  test('loadOcrPrefs returns defaults when storage empty', () => {
    expect(loadOcrPrefs()).toEqual(DEFAULT_OCR_PREFS);
  });

  test('saveOcrPrefs persists + load reads back', () => {
    saveOcrPrefs({ defaultUseLlmVision: true });
    expect(loadOcrPrefs()).toEqual({
      defaultUseLlmVision: true,
      defaultPreferHandwriting: false,
    });
  });

  test('saveOcrPrefs partial merge keeps prior fields', () => {
    saveOcrPrefs({ defaultUseLlmVision: true });
    saveOcrPrefs({ defaultPreferHandwriting: true });
    expect(loadOcrPrefs()).toEqual({
      defaultUseLlmVision: true,
      defaultPreferHandwriting: true,
    });
  });

  test('resetOcrPrefs clears storage → load returns defaults', () => {
    saveOcrPrefs({ defaultUseLlmVision: true, defaultPreferHandwriting: true });
    expect(loadOcrPrefs().defaultUseLlmVision).toBe(true);
    resetOcrPrefs();
    expect(loadOcrPrefs()).toEqual(DEFAULT_OCR_PREFS);
  });

  test('corrupt localStorage value falls back to defaults', () => {
    globalThis.localStorage!.setItem('elanous.ocr.prefs', 'not json{');
    expect(loadOcrPrefs()).toEqual(DEFAULT_OCR_PREFS);
  });

  test('non-boolean field falls back per-field', () => {
    globalThis.localStorage!.setItem(
      'elanous.ocr.prefs',
      JSON.stringify({
        defaultUseLlmVision: 'yes',
        defaultPreferHandwriting: true,
      }),
    );
    expect(loadOcrPrefs()).toEqual({
      defaultUseLlmVision: false,
      defaultPreferHandwriting: true,
    });
  });
});

describe('ocr-prefs · SSR safety', () => {
  let prevWindow: unknown;

  beforeEach(() => {
    prevWindow = globalThis.window;
    delete globalThis.window;
  });
  afterEach(() => {
    globalThis.window = prevWindow as never;
  });

  test('loadOcrPrefs returns defaults outside browser', () => {
    expect(loadOcrPrefs()).toEqual(DEFAULT_OCR_PREFS);
  });

  test('saveOcrPrefs is a no-op outside browser (returns merged)', () => {
    const out = saveOcrPrefs({ defaultUseLlmVision: true });
    expect(out.defaultUseLlmVision).toBe(true);
  });

  test('resetOcrPrefs returns defaults outside browser', () => {
    expect(resetOcrPrefs()).toEqual(DEFAULT_OCR_PREFS);
  });
});
