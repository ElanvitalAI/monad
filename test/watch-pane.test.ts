// ── VW-term Bundle P7-E-α · WatchPane dispatch tests ──

import { afterEach, describe, expect, test } from 'bun:test';

import {
  buildWatchPaneTool,
  dispatchWatchPane,
} from '../src/capture/watch-pane.js';
import { __setDefaultPaneFactory, PaneFactory } from '../src/panes/index.js';
import { createSurfaceRegistry } from '../src/surface/index.js';
import type { Pane, PaneDescription, PaneRef } from '../src/panes/types.js';

// A pane whose snapshot returns whatever `sourceRef.ansi` currently holds.
// The caller mutates `.ansi` between calls to simulate content change.
function makeMutablePane(ref: PaneRef, box: { ansi: string }): Pane {
  const desc: PaneDescription = {
    ref,
    kind: { kind: 'terminal', terminalId: 'term:fake' },
    title: 'fake',
    summary: 'fake',
    supportedTaps: ['raw'],
    chords: [],
    tools: [],
  };
  return {
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
      ansi: box.ansi,
      meta: {},
    }),
    addTap: () => () => {},
    mount: () => {},
    unmount: () => {},
  };
}

function installFakeFactory(pane: Pane | null): void {
  const factory = new PaneFactory();
  (factory as unknown as { peek: () => Pane | undefined }).peek = () =>
    pane ?? undefined;
  __setDefaultPaneFactory(factory);
}

const REF: PaneRef = { windowId: 'w', paneId: 'p' };

afterEach(() => {
  __setDefaultPaneFactory(null);
});

// ── Tool spec ────────────────────────────────────────────────────

describe('WatchPane · tool spec', () => {
  test('spec has expected name + required ref', () => {
    const spec = buildWatchPaneTool();
    expect(spec.name).toBe('WatchPane');
    const p = spec.parameters as Record<string, unknown>;
    expect(p.required).toEqual(['ref']);
  });
});

// ── Dispatch: arg parsing ────────────────────────────────────────

describe('WatchPane · arg parsing', () => {
  test('missing ref → found:false · note', async () => {
    const out = await dispatchWatchPane({});
    expect(out.found).toBe(false);
    expect(out.note).toContain('ref');
    expect(out.events).toEqual([]);
    expect(out.truncated).toBe(false);
  });

  test('pane not in factory → found:false · note', async () => {
    // No factory installed; default is null → peek returns undefined.
    installFakeFactory(null);
    const out = await dispatchWatchPane({ ref: REF });
    expect(out.found).toBe(false);
    expect(out.note).toContain('PaneFactory');
  });
});

// ── Dispatch: observe window ─────────────────────────────────────

describe('WatchPane · observe window', () => {
  test('zero events during window → events:[] · truncated:false', async () => {
    installFakeFactory(makeMutablePane(REF, { ansi: '' }));
    const reg = createSurfaceRegistry();
    let timerCb: (() => void) | null = null;
    const setTimer = (cb: () => void, _ms: number) => { timerCb = cb; return 1; };
    const promise = dispatchWatchPane(
      { ref: REF, durationMs: 1000 },
      { registry: reg, setTimeout: setTimer as never },
    );
    timerCb?.();
    const out = await promise;
    expect(out.found).toBe(true);
    expect(out.events).toEqual([]);
    expect(out.truncated).toBe(false);
    expect(out.windowMs).toBe(1000);
  });

  test('events filtered to this pane only (other panes ignored)', async () => {
    installFakeFactory(makeMutablePane(REF, { ansi: '' }));
    const reg = createSurfaceRegistry();
    let timerCb: (() => void) | null = null;
    const setTimer = (cb: () => void) => { timerCb = cb; return 1; };
    const promise = dispatchWatchPane(
      { ref: REF },
      { registry: reg, setTimeout: setTimer as never },
    );
    reg.register({ addr: { kind: 'pane', ref: REF }, kindTag: 'terminal' });
    reg.register({ addr: { kind: 'pane', ref: { windowId: 'w', paneId: 'other' } }, kindTag: 'terminal' });
    reg.register({ addr: { kind: 'modal', modalId: 'm' }, kindTag: 'dialog' });
    timerCb?.();
    const out = await promise;
    expect(out.events).toHaveLength(1);
    expect(out.events[0]!.addr).toMatchObject({ kind: 'pane', ref: REF });
  });

  test('maxEvents cap + truncated flag', async () => {
    installFakeFactory(makeMutablePane(REF, { ansi: '' }));
    const reg = createSurfaceRegistry();
    let timerCb: (() => void) | null = null;
    const setTimer = (cb: () => void) => { timerCb = cb; return 1; };
    const promise = dispatchWatchPane(
      { ref: REF, maxEvents: 2 },
      { registry: reg, setTimeout: setTimer as never },
    );
    reg.register({ addr: { kind: 'pane', ref: REF }, kindTag: 'terminal' });
    reg.update({ addr: { kind: 'pane', ref: REF }, kindTag: 'terminal', title: 't1' });
    reg.update({ addr: { kind: 'pane', ref: REF }, kindTag: 'terminal', title: 't2' });
    timerCb?.();
    const out = await promise;
    expect(out.events).toHaveLength(2);
    expect(out.truncated).toBe(true);
  });
});

// ── Dispatch: duration clamping ──────────────────────────────────

describe('WatchPane · duration clamping', () => {
  test('durationMs=9999999 clamps to 60000', async () => {
    installFakeFactory(makeMutablePane(REF, { ansi: '' }));
    const reg = createSurfaceRegistry();
    let captured = 0;
    const setTimer = (cb: () => void, ms: number) => { captured = ms; cb(); return 1; };
    const out = await dispatchWatchPane(
      { ref: REF, durationMs: 9_999_999 },
      { registry: reg, setTimeout: setTimer as never },
    );
    expect(captured).toBe(60_000);
    expect(out.windowMs).toBe(60_000);
  });

  test('durationMs=0 clamps up to min 500', async () => {
    installFakeFactory(makeMutablePane(REF, { ansi: '' }));
    const reg = createSurfaceRegistry();
    let captured = 0;
    const setTimer = (cb: () => void, ms: number) => { captured = ms; cb(); return 1; };
    const out = await dispatchWatchPane(
      { ref: REF, durationMs: 0 },
      { registry: reg, setTimeout: setTimer as never },
    );
    expect(captured).toBe(500);
    expect(out.windowMs).toBe(500);
  });
});

// ── Dispatch: snapshotDiff ───────────────────────────────────────

describe('WatchPane · snapshotDiff', () => {
  test('snapshotDiff omitted → no before/after/diff fields', async () => {
    installFakeFactory(makeMutablePane(REF, { ansi: 'x' }));
    const reg = createSurfaceRegistry();
    // Fire the observe timer immediately so the promise completes.
    const setTimer = (cb: () => void) => { cb(); return 1; };
    const out = await dispatchWatchPane(
      { ref: REF },
      { registry: reg, setTimeout: setTimer as never },
    );
    expect(out.before).toBeUndefined();
    expect(out.after).toBeUndefined();
    expect(out.diff).toBeUndefined();
    expect(out.changed).toBeUndefined();
  });

  test('snapshotDiff:true · content stable → changed:false · empty diff', async () => {
    const box = { ansi: 'unchanged' };
    installFakeFactory(makeMutablePane(REF, box));
    const reg = createSurfaceRegistry();
    const setTimer = (cb: () => void) => { cb(); return 1; };
    const out = await dispatchWatchPane(
      { ref: REF, snapshotDiff: true },
      { registry: reg, setTimeout: setTimer as never },
    );
    expect(out.before?.text).toBe('unchanged');
    expect(out.after?.text).toBe('unchanged');
    expect(out.changed).toBe(false);
    expect(out.diff).toBe('');
  });

  test('snapshotDiff:true · content changes during window → changed:true · diff populated', async () => {
    const box = { ansi: 'before-line' };
    installFakeFactory(makeMutablePane(REF, box));
    const reg = createSurfaceRegistry();
    const setTimer = (cb: () => void) => {
      // Mutate the pane content between before/after snapshots so the
      // observe window picks up the change.
      box.ansi = 'after-line';
      cb();
      return 1;
    };
    const out = await dispatchWatchPane(
      { ref: REF, snapshotDiff: true },
      { registry: reg, setTimeout: setTimer as never },
    );
    expect(out.changed).toBe(true);
    expect(out.before?.text).toBe('before-line');
    expect(out.after?.text).toBe('after-line');
    expect(out.diff).toContain('-before-line');
    expect(out.diff).toContain('+after-line');
  });
});
