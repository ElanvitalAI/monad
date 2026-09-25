// ── U-4.1 (PLAN L-1) · log-pane click dispatch unit tests ──
//
// Exercise the externalized `tryAttachmentHitAtBodyRow` + `tryHandleLogAreaClick`
// against stub deps. Covers:
//
//   - empty attachment map → 'no-attachment'
//   - negative rowInBody (title row) → 'no-attachment'
//   - attachment hit → 'popup-opened' (pushModal + debug log fire)
//   - hit but attachment missing from registry → 'no-attachment'
//   - scroll offset mid-history adjusts absIdx lookup
//   - focusOnMiss=true (default) fires setWorkingFocus
//   - focusOnMiss=false (input-mode rule) drops silently

import { describe, test, expect } from 'bun:test';
import {
  tryAttachmentHitAtBodyRow,
  tryAttachmentHitAtLineIndex,
  tryHandleLogAreaClick,
  type LogClickDispatchDeps,
} from '../src/log-pane/click-dispatch.js';
import { createAttachmentRowMap } from '../src/log-pane/attachment-row-map.js';
import { createContextRegistry, addAttachment, type Attachment } from '../src/context.js';
import type { AttachmentPopupAction } from '../src/log-pane/attachment-popup.js';

interface Harness {
  deps: LogClickDispatchDeps;
  pushModalCalls: unknown[];
  setFocusCalls: { pane: 'log'; reason: string }[];
  attachActionCalls: { action: AttachmentPopupAction; attachment: Attachment }[];
  drawCalls: number;
  debugLogCalls: { category: string; msg: string; snap?: unknown }[];
}

function makeHarness(overrides: Partial<{
  termRows: number;
  termCols: number;
  paneH: number;
  logH: number;
  chatLinesLength: number;
  chatScrollOffset: number;
  logFrozenTailIndex: number | null;
  chatFooterLine: string | null;
  attachmentLineIdx: number;     // where to plant a tracked attachment
  omitRegistryEntry: boolean;    // insert into row map but not registry
  debugEnabled: boolean;
  tryPillHit: (absIdx: number) => boolean;
  tryFoldToggle: (absIdx: number) => boolean;
}> = {}): Harness {
  const {
    termRows = 40,
    termCols = 120,
    paneH = 20,
    logH = 18,
    chatLinesLength = 100,
    chatScrollOffset = -1,
    logFrozenTailIndex = null,
    chatFooterLine = null,
    attachmentLineIdx = 99,
    omitRegistryEntry = false,
    debugEnabled = true,
  } = overrides;

  const pushModalCalls: unknown[] = [];
  const setFocusCalls: { pane: 'log'; reason: string }[] = [];
  const attachActionCalls: { action: AttachmentPopupAction; attachment: Attachment }[] = [];
  let drawCalls = 0;
  const debugLogCalls: { category: string; msg: string; snap?: unknown }[] = [];

  const attachmentRowMap = createAttachmentRowMap();
  const contextRegistry = createContextRegistry();

  // Plant one attachment + row-map entry unless caller opts out.
  const attachment = addAttachment(contextRegistry, {
    kind: 'md',
    token: '[Md #1]',
    sourcePath: '/tmp/test.md',
    filename: 'test.md',
    sizeBytes: 1024,
    mtime: Date.now(),
  });
  if (!omitRegistryEntry) {
    attachmentRowMap.track(attachmentLineIdx, attachment.id);
  } else {
    // Track a row-map entry that points to a non-registered id so we
    // exercise the "registry miss" branch.
    attachmentRowMap.track(attachmentLineIdx, 9999);
  }

  const deps: LogClickDispatchDeps = {
    termSize: () => ({ rows: termRows, cols: termCols }),
    computePaneH: () => paneH,
    computeLogH: () => logH,
    chatLinesLength: () => chatLinesLength,
    chatScrollOffset: () => chatScrollOffset,
    logFrozenTailIndex: () => logFrozenTailIndex,
    chatFooterLine: () => chatFooterLine,
    attachmentRowMap,
    contextRegistry,
    setWorkingFocus: (pane, reason) => { setFocusCalls.push({ pane, reason }); },
    pushModal: (surface) => { pushModalCalls.push(surface); },
    onAttachmentAction: (action, attachment) => {
      attachActionCalls.push({ action, attachment });
    },
    draw: () => { drawCalls++; },
    debug: {
      enabled: debugEnabled,
      log: (category, msg, snap) => { debugLogCalls.push({ category, msg, snap }); },
    },
    ...(overrides.tryPillHit ? { tryPillHit: overrides.tryPillHit } : {}),
    ...(overrides.tryFoldToggle ? { tryFoldToggle: overrides.tryFoldToggle } : {}),
  };

  return { deps, pushModalCalls, setFocusCalls, attachActionCalls, drawCalls, debugLogCalls };
}

// ── tryAttachmentHitAtBodyRow ────────────────────────────────────────

describe('tryAttachmentHitAtBodyRow', () => {
  test('empty map → no-attachment (fast exit, no debug log)', () => {
    const h = makeHarness();
    // Clear the map to hit the empty-map early return.
    h.deps.attachmentRowMap.clear();
    const result = tryAttachmentHitAtBodyRow(5, { row: 30, col: 10 }, h.deps);
    expect(result).toBe('no-attachment');
    expect(h.pushModalCalls).toHaveLength(0);
    expect(h.debugLogCalls).toHaveLength(0);
  });

  test('negative rowInBody (title row) → no-attachment', () => {
    const h = makeHarness();
    const result = tryAttachmentHitAtBodyRow(-1, { row: 21, col: 10 }, h.deps);
    expect(result).toBe('no-attachment');
    expect(h.pushModalCalls).toHaveLength(0);
  });

  test('hit on tracked attachment row → popup-opened · pushModal fired', () => {
    // At scroll=-1 (pinned), visibleLen=100, contentH=17 (logH=18, bodyH=17,
    // no footer → contentH=17). maxScroll=100-17=83. start=83. rowInBody=16
    // → absIdx=99 → our planted attachment (line 99).
    const h = makeHarness();
    const result = tryAttachmentHitAtBodyRow(16, { row: 36, col: 20 }, h.deps);
    expect(result).toBe('popup-opened');
    expect(h.pushModalCalls).toHaveLength(1);
  });

  test('pushModal receives the full ViewSurfaceHandle (not just surface)', () => {
    // TECH-DEBT-modal-lifecycle-and-paint §1-1 fix: dashboard needs the
    // handle so it can dispose the previous popup before the next push.
    // If this test breaks, popup pile-up bug recurs.
    const h = makeHarness();
    tryAttachmentHitAtBodyRow(16, { row: 36, col: 20 }, h.deps);
    expect(h.pushModalCalls).toHaveLength(1);
    const pushed = h.pushModalCalls[0] as { surface: unknown; dispose: () => void; isDisposed: () => boolean };
    expect(pushed.surface).toBeDefined();
    expect(typeof pushed.dispose).toBe('function');
    expect(typeof pushed.isDisposed).toBe('function');
  });

  test('row maps to attachment id but registry is missing it → no-attachment', () => {
    const h = makeHarness({ omitRegistryEntry: true });
    const result = tryAttachmentHitAtBodyRow(16, { row: 36, col: 20 }, h.deps);
    expect(result).toBe('no-attachment');
    expect(h.pushModalCalls).toHaveLength(0);
  });

  test('footer present → contentH shrinks by 2 · start recomputed', () => {
    // chatFooterLine set → contentH = 18 - 1 - 2 = 15. maxScroll = 100 - 15 = 85.
    // Attachment at line 99 → rowInBody needed = 99 - 85 = 14.
    const h = makeHarness({ chatFooterLine: '1 of 5 matches' });
    const result = tryAttachmentHitAtBodyRow(14, { row: 34, col: 20 }, h.deps);
    expect(result).toBe('popup-opened');
  });

  test('explicit scroll offset overrides maxScroll · absIdx = scroll + rowInBody', () => {
    // scrollOffset=10, rowInBody=5 → absIdx=15. Track attachment at 15.
    const h = makeHarness({ chatScrollOffset: 10, attachmentLineIdx: 15 });
    const result = tryAttachmentHitAtBodyRow(5, { row: 25, col: 20 }, h.deps);
    expect(result).toBe('popup-opened');
  });

  test('frozen tail index + scroll=-1 → still uses maxScroll from chatLinesLength (scroll=-1 overrides frozen)', () => {
    // When scroll === -1, the freeze is bypassed — visibleLen falls
    // back to chatLines.length. maxScroll computation uses 100, same
    // as the pinned case above.
    const h = makeHarness({ logFrozenTailIndex: 50, chatScrollOffset: -1 });
    const result = tryAttachmentHitAtBodyRow(16, { row: 36, col: 20 }, h.deps);
    expect(result).toBe('popup-opened');
  });

  test('frozen tail index + positive scroll → visibleLen = frozen', () => {
    // scroll=0 (not -1) + freeze=50 → visibleLen=50. contentH=17.
    // maxScroll=max(0, 50-17)=33. start=min(0, 33)=0. rowInBody=15 → absIdx=15.
    const h = makeHarness({
      logFrozenTailIndex: 50,
      chatScrollOffset: 0,
      attachmentLineIdx: 15,
    });
    const result = tryAttachmentHitAtBodyRow(15, { row: 35, col: 20 }, h.deps);
    expect(result).toBe('popup-opened');
  });

  test('debug log categories fire on hit-test + click (when enabled)', () => {
    const h = makeHarness();
    tryAttachmentHitAtBodyRow(16, { row: 36, col: 20 }, h.deps);
    const categories = h.debugLogCalls.map((c) => c.category);
    expect(categories).toContain('log-pane.attachment-hittest');
    expect(categories).toContain('log-pane.attachment-click');
  });

  test('debug disabled → no debug calls fire', () => {
    const h = makeHarness({ debugEnabled: false });
    const result = tryAttachmentHitAtBodyRow(16, { row: 36, col: 20 }, h.deps);
    expect(result).toBe('popup-opened');
    expect(h.debugLogCalls).toHaveLength(0);
  });

  test('empty map + successful fold toggle → popup-opened (handled)', () => {
    const seen: number[] = [];
    const h = makeHarness({
      tryFoldToggle: (absIdx) => { seen.push(absIdx); return true; },
    });
    h.deps.attachmentRowMap.clear();
    const result = tryAttachmentHitAtBodyRow(5, { row: 30, col: 10 }, h.deps);
    expect(result).toBe('popup-opened');
    expect(h.pushModalCalls).toHaveLength(0);
    expect(seen).toEqual([88]);
  });

  test('empty map + failed fold toggle → no-attachment (legacy miss)', () => {
    let calls = 0;
    const h = makeHarness({
      tryFoldToggle: () => { calls++; return false; },
    });
    h.deps.attachmentRowMap.clear();
    const result = tryAttachmentHitAtBodyRow(5, { row: 30, col: 10 }, h.deps);
    expect(result).toBe('no-attachment');
    expect(h.pushModalCalls).toHaveLength(0);
    expect(calls).toBe(1);
  });

  test('empty map + omitted fold toggle → no-attachment (legacy)', () => {
    const h = makeHarness();
    h.deps.attachmentRowMap.clear();
    const result = tryAttachmentHitAtBodyRow(5, { row: 30, col: 10 }, h.deps);
    expect(result).toBe('no-attachment');
    expect(h.pushModalCalls).toHaveLength(0);
  });

  test('map present but line misses + successful fold toggle → popup-opened · hook once (no double toggle)', () => {
    const seen: number[] = [];
    const h = makeHarness({
      attachmentLineIdx: 99,
      tryFoldToggle: (absIdx) => { seen.push(absIdx); return true; },
    });
    const result = tryAttachmentHitAtBodyRow(5, { row: 30, col: 10 }, h.deps);
    expect(result).toBe('popup-opened');
    expect(h.pushModalCalls).toHaveLength(0);
    expect(seen).toEqual([88]);
    expect(seen).toHaveLength(1);
  });

  test('map present but line misses + failed fold toggle → no-attachment', () => {
    let calls = 0;
    const h = makeHarness({
      tryFoldToggle: () => { calls++; return false; },
    });
    const result = tryAttachmentHitAtBodyRow(5, { row: 30, col: 10 }, h.deps);
    expect(result).toBe('no-attachment');
    expect(h.pushModalCalls).toHaveLength(0);
    expect(calls).toBe(1);
  });

  test('attachment hit wins over fold toggle (priority)', () => {
    let foldCalls = 0;
    const h = makeHarness({
      tryFoldToggle: () => { foldCalls++; return true; },
    });
    const result = tryAttachmentHitAtBodyRow(16, { row: 36, col: 20 }, h.deps);
    expect(result).toBe('popup-opened');
    expect(h.pushModalCalls).toHaveLength(1);
    expect(foldCalls).toBe(0);
  });

  test('pill hit wins over fold toggle', () => {
    let foldCalls = 0;
    let pillCalls = 0;
    const h = makeHarness({
      tryPillHit: () => { pillCalls++; return true; },
      tryFoldToggle: () => { foldCalls++; return true; },
    });
    h.deps.attachmentRowMap.clear();
    const result = tryAttachmentHitAtBodyRow(5, { row: 30, col: 10 }, h.deps);
    expect(result).toBe('popup-opened');
    expect(pillCalls).toBe(1);
    expect(foldCalls).toBe(0);
    expect(h.pushModalCalls).toHaveLength(0);
  });
});

describe('tryAttachmentHitAtLineIndex', () => {
  test('absolute source line index opens popup without scroll math', () => {
    const h = makeHarness({ attachmentLineIdx: 42 });
    const result = tryAttachmentHitAtLineIndex(42, { row: 18, col: 9 }, h.deps);
    expect(result).toBe('popup-opened');
    expect(h.pushModalCalls).toHaveLength(1);
  });

  test('debug hit-test logs carry absolute-line metadata when body row is absent', () => {
    const h = makeHarness({ attachmentLineIdx: 7 });
    tryAttachmentHitAtLineIndex(7, { row: 12, col: 4 }, h.deps);
    const hit = h.debugLogCalls.find(call => call.category === 'log-pane.attachment-hittest');
    expect(hit).toBeDefined();
    expect((hit!.snap as { absIdx: number }).absIdx).toBe(7);
  });

  test('no-attachment line + successful fold toggle → popup-opened · hook once', () => {
    const seen: number[] = [];
    const h = makeHarness({
      attachmentLineIdx: 99,
      tryFoldToggle: (absIdx) => { seen.push(absIdx); return true; },
    });
    const result = tryAttachmentHitAtLineIndex(7, { row: 12, col: 4 }, h.deps);
    expect(result).toBe('popup-opened');
    expect(h.pushModalCalls).toHaveLength(0);
    expect(seen).toEqual([7]);
  });

  test('no-attachment line + failed fold toggle → no-attachment', () => {
    let calls = 0;
    const h = makeHarness({
      tryFoldToggle: () => { calls++; return false; },
    });
    const result = tryAttachmentHitAtLineIndex(7, { row: 12, col: 4 }, h.deps);
    expect(result).toBe('no-attachment');
    expect(h.pushModalCalls).toHaveLength(0);
    expect(calls).toBe(1);
  });

  test('no-attachment line + omitted fold toggle → no-attachment (legacy)', () => {
    const h = makeHarness();
    const result = tryAttachmentHitAtLineIndex(7, { row: 12, col: 4 }, h.deps);
    expect(result).toBe('no-attachment');
    expect(h.pushModalCalls).toHaveLength(0);
  });

  test('attachment hit wins over fold toggle (hook never called)', () => {
    let foldCalls = 0;
    const h = makeHarness({
      attachmentLineIdx: 42,
      tryFoldToggle: () => { foldCalls++; return true; },
    });
    const result = tryAttachmentHitAtLineIndex(42, { row: 18, col: 9 }, h.deps);
    expect(result).toBe('popup-opened');
    expect(h.pushModalCalls).toHaveLength(1);
    expect(foldCalls).toBe(0);
  });

  test('registry miss + successful fold toggle → popup-opened · hook once', () => {
    const seen: number[] = [];
    const h = makeHarness({
      attachmentLineIdx: 42,
      omitRegistryEntry: true,
      tryFoldToggle: (absIdx) => { seen.push(absIdx); return true; },
    });
    const result = tryAttachmentHitAtLineIndex(42, { row: 18, col: 9 }, h.deps);
    expect(result).toBe('popup-opened');
    expect(h.pushModalCalls).toHaveLength(0);
    expect(seen).toEqual([42]);
  });
});

// ── tryHandleLogAreaClick ────────────────────────────────────────────

describe('tryHandleLogAreaClick', () => {
  test('click on attachment row → popup-opened · no focus shift (tier order preserved)', () => {
    // paneH=20 → logStart=21. To reach rowInBody=16 (absIdx=99 → attachment),
    // the absolute row = logStart + 1 + 16 = 38.
    const h = makeHarness();
    const result = tryHandleLogAreaClick({ row: 38, col: 10, type: 'click' }, h.deps);
    expect(result).toBe('popup-opened');
    expect(h.setFocusCalls).toHaveLength(0);
  });

  test('click on plain row with focusOnMiss=true (default) → focused', () => {
    const h = makeHarness();
    const result = tryHandleLogAreaClick({ row: 25, col: 10, type: 'click' }, h.deps);
    expect(result).toBe('focused');
    expect(h.setFocusCalls).toEqual([{ pane: 'log', reason: 'log-area-click' }]);
  });

  test('click on plain row with focusOnMiss=false → no-attachment (input-mode rule)', () => {
    const h = makeHarness();
    const result = tryHandleLogAreaClick(
      { row: 25, col: 10, type: 'click' },
      h.deps,
      { focusOnMiss: false },
    );
    expect(result).toBe('no-attachment');
    expect(h.setFocusCalls).toHaveLength(0);
  });

  test('outer wrapper emits log-pane.area-click on miss with focusOnMiss flag recorded', () => {
    const h = makeHarness();
    tryHandleLogAreaClick(
      { row: 25, col: 10, type: 'click' },
      h.deps,
      { focusOnMiss: false },
    );
    const areaCall = h.debugLogCalls.find((c) => c.category === 'log-pane.area-click');
    expect(areaCall).toBeDefined();
    expect((areaCall!.snap as { focusOnMiss: boolean }).focusOnMiss).toBe(false);
  });

  test('title-row click (rowInBody=-1 via absRow = logStart+1) → no-attachment · focus still shifts on focusOnMiss=true', () => {
    // absRow=22 = logStart(21)+1 → rowInBody = 22 - 22 = 0? No: the code
    // does `m.row - (logStart + 1)` so absRow=22 → 0 = first body row.
    // To hit title, absRow=21 → rowInBody = -1. Inner helper returns
    // 'no-attachment', outer falls through to focus shift.
    const h = makeHarness();
    const result = tryHandleLogAreaClick({ row: 21, col: 10, type: 'click' }, h.deps);
    expect(result).toBe('focused');
    expect(h.setFocusCalls).toHaveLength(1);
  });
});
