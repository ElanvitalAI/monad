import { afterEach, describe, expect, test } from 'bun:test';

import {
  capturePane,
  registerPaneContentLookup,
  type OcrBackend,
} from '../src/virtual-windows/pane-capture.js';
import { createAddressBook } from '../src/virtual-windows/addressing.js';

afterEach(() => {
  registerPaneContentLookup(() => null);
});

function wireContent(id: string, body: string) {
  registerPaneContentLookup((pid) => pid === id ? { capture: () => body } : null);
}

describe('capturePane', () => {
  test('returns null when pane not registered', async () => {
    const book = createAddressBook();
    const r = await capturePane(book, 'pane:nope');
    expect(r).toBeNull();
  });

  test('default text capture', async () => {
    const book = createAddressBook();
    book.registerWindow({ id: 1, title: 'w' });
    book.registerPane({ id: 'a', windowId: 1, kind: 'terminal' });
    wireContent('a', 'hello world');
    const r = await capturePane(book, 'pane:a');
    expect(r).not.toBeNull();
    expect(r!.body).toContain('hello world');
    expect(r!.mode).toBe('auto');
    expect(r!.ocrBackendUsed).toBe(false);
  });

  test('text mode strips ANSI', async () => {
    const book = createAddressBook();
    book.registerWindow({ id: 1, title: 'w' });
    book.registerPane({ id: 'a', windowId: 1, kind: 'terminal' });
    wireContent('a', '\x1b[31mRED\x1b[0m');
    const r = await capturePane(book, 'pane:a', { mode: 'text' });
    expect(r!.body).toBe('RED');
  });

  test('ocr mode uses backend when content is empty', async () => {
    const book = createAddressBook();
    book.registerWindow({ id: 1, title: 'w' });
    book.registerPane({ id: 'a', windowId: 1, kind: 'terminal' });
    wireContent('a', '');
    const backend: OcrBackend = {
      available: () => true,
      run: async (_s) => 'ocr-result',
    };
    const r = await capturePane(book, 'pane:a', { mode: 'auto', ocrBackend: backend });
    expect(r!.body).toContain('ocr-result');
    expect(r!.ocrBackendUsed).toBe(true);
  });

  test('explicit ocr mode reports missing backend', async () => {
    const book = createAddressBook();
    book.registerWindow({ id: 1, title: 'w' });
    book.registerPane({ id: 'a', windowId: 1, kind: 'terminal' });
    wireContent('a', 'fallback text');
    const backend: OcrBackend = {
      available: () => false,
      run: async () => 'never called',
    };
    const r = await capturePane(book, 'pane:a', { mode: 'ocr', ocrBackend: backend });
    expect(r!.body).toContain('OCR backend unavailable');
  });

  test('ocr run() error wrapped into body', async () => {
    const book = createAddressBook();
    book.registerWindow({ id: 1, title: 'w' });
    book.registerPane({ id: 'a', windowId: 1, kind: 'terminal' });
    wireContent('a', '');
    const backend: OcrBackend = {
      available: () => true,
      run: async () => { throw new Error('engine crashed'); },
    };
    const r = await capturePane(book, 'pane:a', { mode: 'auto', ocrBackend: backend });
    expect(r!.body).toContain('OCR error');
    expect(r!.body).toContain('engine crashed');
  });

  test('auto mode skips OCR when text is present', async () => {
    const book = createAddressBook();
    book.registerWindow({ id: 1, title: 'w' });
    book.registerPane({ id: 'a', windowId: 1, kind: 'terminal' });
    wireContent('a', 'actual content');
    let called = false;
    const backend: OcrBackend = {
      available: () => { called = true; return true; },
      run: async () => 'never',
    };
    const r = await capturePane(book, 'pane:a', { mode: 'auto', ocrBackend: backend });
    expect(called).toBe(false);
    expect(r!.ocrBackendUsed).toBe(false);
  });
});
