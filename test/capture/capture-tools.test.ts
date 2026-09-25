// ── Capture Phase 2 (partial) — tool surface tests ──
//
// Exercise the Screenshot + InspectPane dispatchers against a fake
// PaneFactory so the test surface doesn't need a live dashboard.

import { afterEach, describe, expect, test } from 'bun:test';

import {
  dispatchInspectPane,
  dispatchScreenshot,
} from '../../src/capture/capture-tools.js';
import {
  createPaneSource,
  PaneSourceNotFoundError,
  resolvePaneAnsi,
} from '../../src/capture/sources/pane-source.js';
import { __setDefaultPaneFactory, PaneFactory } from '../../src/panes/index.js';
import type { Pane, PaneDescription } from '../../src/panes/types.js';

function makeFakePane(ansi: string, descOverrides: Partial<PaneDescription> = {}): Pane {
  const ref = { windowId: 'w:fake', paneId: 'p:fake' };
  const desc: PaneDescription = {
    ref,
    kind: { kind: 'terminal', terminalId: 'term:fake' },
    title: 'fake',
    summary: 'fake pane for tests',
    supportedTaps: ['raw', 'frame', 'event'],
    chords: [],
    tools: [],
    ...descOverrides,
  };
  const pane: Pane = {
    ref,
    kind: desc.kind,
    render: () => [],
    onKey: () => 'passthrough',
    onMouse: () => 'passthrough',
    describe: () => desc,
    snapshot: async () => ({
      ref,
      kind: desc.kind,
      capturedAt: 0,
      dims: { row: 0, col: 0, width: 80, height: 24 },
      ansi,
      meta: {},
    }),
    addTap: () => () => {},
    mount: () => {},
    unmount: () => {},
  };
  return pane;
}

function installFakeFactory(pane: Pane): PaneFactory {
  const factory = new PaneFactory();
  // Inject via the content adapter path to get it into the cache.
  // Simpler: monkey-patch peek to return the fake.
  (factory as unknown as { peek: (ref: unknown) => Pane | undefined }).peek = (_ref) => pane;
  __setDefaultPaneFactory(factory);
  return factory;
}

afterEach(() => {
  __setDefaultPaneFactory(null);
});

// ── pane-source ─────────────────────────────────────────────────

describe('pane-source', () => {
  test('resolvePaneAnsi returns snapshot ansi', async () => {
    installFakeFactory(makeFakePane('\x1b[31mRED\x1b[0m'));
    const ansi = await resolvePaneAnsi({ windowId: 'w:fake', paneId: 'p:fake' });
    expect(ansi).toContain('RED');
  });

  test('createPaneSource yields a reusable closure', async () => {
    installFakeFactory(makeFakePane('stream-output'));
    const source = createPaneSource({ windowId: 'w:fake', paneId: 'p:fake' });
    const first = await source();
    const second = await source();
    expect(first).toBe('stream-output');
    expect(second).toBe('stream-output');
  });

  test('missing pane raises PaneSourceNotFoundError', async () => {
    installFakeFactory(makeFakePane(''));
    // Override peek to return undefined for this test.
    const factory = new PaneFactory();
    (factory as unknown as { peek: () => undefined }).peek = () => undefined;
    __setDefaultPaneFactory(factory);
    await expect(resolvePaneAnsi({ windowId: 'w', paneId: 'missing' }))
      .rejects.toBeInstanceOf(PaneSourceNotFoundError);
  });
});

// ── dispatchScreenshot ──────────────────────────────────────────

describe('dispatchScreenshot', () => {
  test('text format returns stripped body', async () => {
    installFakeFactory(makeFakePane('\x1b[31mhello\x1b[0m world'));
    const result = await dispatchScreenshot({
      windowId: 'w:fake', paneId: 'p:fake', format: 'text',
    });
    expect(result.format).toBe('text');
    expect(result.body).toContain('hello world');
    expect(result.body).not.toContain('\x1b');
  });

  test('ansi format preserves SGR', async () => {
    installFakeFactory(makeFakePane('\x1b[32mgreen\x1b[0m'));
    const result = await dispatchScreenshot({
      windowId: 'w:fake', paneId: 'p:fake', format: 'ansi',
    });
    expect(result.format).toBe('ansi');
    expect(result.body).toContain('\x1b[32m');
  });

  test('svg format produces SVG string in body', async () => {
    installFakeFactory(makeFakePane('hello'));
    const result = await dispatchScreenshot({
      windowId: 'w:fake', paneId: 'p:fake', format: 'svg',
      cols: 40, rows: 5,
    });
    expect(result.format).toBe('svg');
    expect(result.body!.startsWith('<svg ')).toBe(true);
    expect(result.bodyBase64).toBeUndefined();
  });

  test('png format returns base64 body', async () => {
    installFakeFactory(makeFakePane('visual'));
    const result = await dispatchScreenshot({
      windowId: 'w:fake', paneId: 'p:fake', format: 'png',
      cols: 20, rows: 3,
    });
    expect(result.format).toBe('png');
    expect(result.bodyBase64).toBeDefined();
    // PNG magic bytes in base64 start with "iVBORw0KG".
    expect(result.bodyBase64!.startsWith('iVBORw0KG')).toBe(true);
    expect(result.body).toBeUndefined();
    expect(result.bytes).toBeGreaterThan(0);
  });

  test('missing pane → note with no crash', async () => {
    const factory = new PaneFactory();
    (factory as unknown as { peek: () => undefined }).peek = () => undefined;
    __setDefaultPaneFactory(factory);
    const result = await dispatchScreenshot({
      windowId: 'w:gone', paneId: 'p:gone', format: 'text',
    });
    expect(result.format).toBe('text');
    expect(result.bytes).toBe(0);
    expect(result.note).toContain('not found');
  });

  test('missing required paneId throws with guidance', async () => {
    await expect(dispatchScreenshot({ windowId: 'w' }))
      .rejects.toThrow(/paneId/);
  });

  test('unsupported format rejected', async () => {
    await expect(dispatchScreenshot({
      windowId: 'w', paneId: 'p', format: 'bogus',
    })).rejects.toThrow(/unsupported format/);
  });
});

// ── dispatchInspectPane ─────────────────────────────────────────

describe('dispatchInspectPane', () => {
  test('returns describe payload for existing pane', () => {
    installFakeFactory(makeFakePane('', {
      title: 'my-title',
      summary: 'summary-line',
      supportedTaps: ['raw', 'frame'],
    }));
    const out = dispatchInspectPane({ windowId: 'w:fake', paneId: 'p:fake' });
    expect(out.found).toBe(true);
    expect(out.title).toBe('my-title');
    expect(out.summary).toBe('summary-line');
    expect(out.supportedTaps).toEqual(['raw', 'frame']);
    expect(out.kind).toBe('terminal');
  });

  test('missing pane → found:false + note', () => {
    const factory = new PaneFactory();
    (factory as unknown as { peek: () => undefined }).peek = () => undefined;
    __setDefaultPaneFactory(factory);
    const out = dispatchInspectPane({ windowId: 'w', paneId: 'miss' });
    expect(out.found).toBe(false);
    expect(out.note).toContain('not found');
  });

  test('missing paneId throws', () => {
    expect(() => dispatchInspectPane({ windowId: 'w' })).toThrow(/paneId/);
  });
});
