// ── U-4.3 · wd-log widget onMouse tests ──
//
// Covers the new widget.onMouse handler that replaces the 3
// non-embedded log-click branches in dashboard.ts. Key invariants:
// - Non-click events (scroll/drag/release) return {type: 'none'}
// - Title row click (localRow 0) → 'none' (no body row)
// - Body row click WITH attachment → popup mounted via deps
// - Body row click WITHOUT attachment → 'none' (no popup, no side effect)
// - Missing clickDeps → 'none' (graceful degrade)
// - Abs coord computation uses stashed origin from last render

import { afterEach, describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import logWidget, { MAPPED_INDEX_TABLE_PREFIX_CAP, type LogWidgetState } from '../widgets/log/widget.js';
import { createAttachmentRowMap } from '../src/log-pane/attachment-row-map.js';
import { createContextRegistry, addAttachment } from '../src/context.js';
import type { LogClickDispatchDeps } from '../src/log-pane/click-dispatch.js';
import { createAttachmentPopup } from '../src/log-pane/attachment-popup.js';
import { debug } from '../src/debug/log.js';
import { LogStore, StoreSink } from '../src/mss/logging/log-store.js';

interface Harness {
  deps: LogClickDispatchDeps;
  pushModalCalls: number;
  setFocusCalls: string[];
  drawCalls: number;
}

function makeDeps(opts: { withAttachmentAtLine?: number } = {}): Harness {
  const attachmentRowMap = createAttachmentRowMap();
  const contextRegistry = createContextRegistry();
  const attachment = addAttachment(contextRegistry, {
    kind: 'md',
    token: '[Md #1]',
    sourcePath: '/tmp/x.md',
    filename: 'x.md',
    sizeBytes: 100,
    mtime: Date.now(),
  });
  if (opts.withAttachmentAtLine !== undefined) {
    attachmentRowMap.track(opts.withAttachmentAtLine, attachment.id);
  }

  let pushModalCalls = 0;
  let drawCalls = 0;
  const setFocusCalls: string[] = [];

  const deps: LogClickDispatchDeps = {
    termSize: () => ({ rows: 40, cols: 120 }),
    computePaneH: () => 20,
    computeLogH: () => 18,
    chatLinesLength: () => 100,
    chatScrollOffset: () => -1,
    logFrozenTailIndex: () => null,
    chatFooterLine: () => null,
    attachmentRowMap,
    contextRegistry,
    setWorkingFocus: (_pane, reason) => { setFocusCalls.push(reason); },
    pushModal: () => { pushModalCalls++; },
    onAttachmentAction: () => {},
    draw: () => { drawCalls++; },
    debug: { enabled: false, log: () => {} },
  };

  return {
    deps,
    get pushModalCalls() { return pushModalCalls; },
    get setFocusCalls() { return setFocusCalls; },
    get drawCalls() { return drawCalls; },
  };
}

function baseState(overrides: Partial<LogWidgetState> = {}): LogWidgetState {
  return {
    lines: [],
    scrollOffset: -1,
    focused: false,
    scroll: 0,
    ...overrides,
  };
}

const fakeCtx = { widgetId: 'wd-log', widgetType: 'log', character: 'Log', state: {} };

type LogMouseRecord = { category: string; event: string; data?: Record<string, unknown> };

function snapshotDebugGates() {
  return {
    file: debug.isFileEnabled(),
    mirror: debug.isMirrorEnabled(),
    verbose: debug.isVerboseEnabled(),
    diag: debug.isDiagEnabled(),
    keytrace: debug.isKeyTraceEnabled(),
  };
}

function restoreDebugGates(prev: ReturnType<typeof snapshotDebugGates>): void {
  debug.setFileEnabled(prev.file);
  debug.setMirror(prev.mirror);
  debug.setVerboseEnabled(prev.verbose);
  debug.setDiagEnabled(prev.diag);
  debug.setKeyTraceEnabled(prev.keytrace);
}

/** Real logger + isolated LogStore. Trail keeps `debug.enabled === false`
 *  while file capture still delivers ungated `debug.log` into the store. */
function observeCategoryInStore(exactCategory: string): {
  records: () => LogMouseRecord[];
  restore: () => void;
} {
  const prev = snapshotDebugGates();
  debug.setLevel('trail');
  debug.clear();
  const store = new LogStore(':memory:');
  const sink = new StoreSink(store, 'tui', {
    flushIntervalMs: 60_000,
    flushBatchSize: 1_000_000,
  });
  const unregister = debug.registerSink(sink);
  return {
    records() {
      sink.flush();
      debug.flush();
      return store.query({ exactCategories: [exactCategory], limit: 50 }).map((row) => {
        const parsed = row.data ? JSON.parse(row.data) as Record<string, unknown> : undefined;
        if (parsed && 'runId' in parsed) delete parsed.runId;
        return {
          category: row.category,
          event: row.event,
          ...(parsed ? { data: parsed } : {}),
        };
      }).reverse();
    },
    restore() {
      unregister();
      store.close();
      restoreDebugGates(prev);
      debug.clear();
    },
  };
}

function observeLogMouseInStore(): {
  records: () => LogMouseRecord[];
  restore: () => void;
} {
  return observeCategoryInStore('log.mouse');
}

function observeWdLogRenderInStore(): {
  records: () => LogMouseRecord[];
  restore: () => void;
} {
  return observeCategoryInStore('dashboard.chat.stream');
}

const WD_LOG_RENDER_NINE_FIELDS = [
  'ctxHeight',
  'ctxWidth',
  'stateLinesLen',
  'scrollOffset',
  'hasFooter',
  'bodyLineCount',
  'visibleLineIndicesCount',
  'firstVisibleIdx',
  'lastVisibleIdx',
] as const;

function renderCtx(overrides: Record<string, unknown> = {}) {
  return {
    width: 80,
    height: 20,
    focused: true,
    ...overrides,
  };
}

describe('wd-log widget · onMouse (U-4.3)', () => {
  test('non-click events return {type: "none"} · no side effects', () => {
    const h = makeDeps({ withAttachmentAtLine: 99 });
    const state = baseState({ clickDeps: h.deps, lastRenderOriginRow: 5, lastRenderOriginCol: 1 });
    const types = ['scroll-up', 'scroll-down', 'drag', 'release'] as const;
    for (const type of types) {
      const action = logWidget.onMouse!({ type, row: 5, col: 10 }, state, fakeCtx as never);
      expect(action).toEqual({ type: 'none' });
    }
    expect(h.pushModalCalls).toBe(0);
  });

  test('click on title row (localRow=0) → none, no popup', () => {
    const h = makeDeps({ withAttachmentAtLine: 99 });
    const state = baseState({ clickDeps: h.deps, lastRenderOriginRow: 5 });
    const action = logWidget.onMouse!({ type: 'click', row: 0, col: 10 }, state, fakeCtx as never);
    expect(action).toEqual({ type: 'none' });
    expect(h.pushModalCalls).toBe(0);
  });

  test('click on body row → attachment hit-test runs · popup mounted', () => {
    // attachmentRowMap tracks line 99 · tryAttachmentHitAtBodyRow
    // computes absIdx from scroll math · with chatLines=100, scroll=-1,
    // contentH=17, maxScroll=83, start=83, rowInBody=16 → absIdx=99.
    const h = makeDeps({ withAttachmentAtLine: 99 });
    const state = baseState({
      lines: Array.from({ length: 100 }, (_, i) => `l${i}`),
      clickDeps: h.deps,
      lastRenderOriginRow: 5,
      lastRenderOriginCol: 1,
    });
    // rowInBody=16 → ev.row = 17 (localRow 0 = title).
    const action = logWidget.onMouse!({ type: 'click', row: 17, col: 10 }, state, fakeCtx as never);
    expect(action).toEqual({ type: 'none' });
    expect(h.pushModalCalls).toBe(1);
  });

  test('filtered viewport click maps visible row back to source line index', () => {
    const h = makeDeps({ withAttachmentAtLine: 99 });
    const state = baseState({
      lines: Array.from({ length: 100 }, (_, i) => i === 99 ? 'needle attachment' : `line-${i}`),
      clickDeps: h.deps,
      filterQuery: 'needle',
      lastRenderOriginRow: 5,
      lastRenderOriginCol: 1,
    });
    logWidget.render!(state, { width: 80, height: 20, focused: true } as never);
    const action = logWidget.onMouse!({ type: 'click', row: 1, col: 10 }, state, fakeCtx as never);
    expect(action).toEqual({ type: 'none' });
    expect(h.pushModalCalls).toBe(1);
  });

  test('click on body row WITHOUT attachment → none, no popup', () => {
    // Same scroll math but no attachment tracked.
    const h = makeDeps();
    const state = baseState({
      lines: Array.from({ length: 100 }, (_, i) => `l${i}`),
      clickDeps: h.deps,
      lastRenderOriginRow: 5,
    });
    const action = logWidget.onMouse!({ type: 'click', row: 17, col: 10 }, state, fakeCtx as never);
    expect(action).toEqual({ type: 'none' });
    expect(h.pushModalCalls).toBe(0);
  });

  test('missing clickDeps → none (graceful degrade)', () => {
    const state = baseState({ clickDeps: null });
    const action = logWidget.onMouse!({ type: 'click', row: 5, col: 10 }, state, fakeCtx as never);
    expect(action).toEqual({ type: 'none' });
  });

  test('double-click behaves like click · popup mount when attachment hit', () => {
    const h = makeDeps({ withAttachmentAtLine: 99 });
    const state = baseState({
      lines: Array.from({ length: 100 }, (_, i) => `l${i}`),
      clickDeps: h.deps,
      lastRenderOriginRow: 5,
    });
    logWidget.onMouse!({ type: 'double-click', row: 17, col: 10 }, state, fakeCtx as never);
    expect(h.pushModalCalls).toBe(1);
  });

  test('render stashes origin · onMouse uses it for abs coords', () => {
    const state = baseState();
    const renderCtx = {
      width: 80,
      height: 20,
      focused: true,
      originRow: 12,
      originCol: 3,
    };
    logWidget.render!(state, renderCtx as never);
    expect(state.lastRenderOriginRow).toBe(12);
    expect(state.lastRenderOriginCol).toBe(3);
  });

  test('render with no origin in ctx · state fields unchanged', () => {
    const state = baseState({ lastRenderOriginRow: 99, lastRenderOriginCol: 99 });
    const renderCtx = { width: 80, height: 20, focused: false };
    logWidget.render!(state, renderCtx as never);
    // Renderer keeps the previous value when ctx.originRow is undefined.
    expect(state.lastRenderOriginRow).toBe(99);
    expect(state.lastRenderOriginCol).toBe(99);
  });
});

describe('wd-log widget · onMouse log.mouse reach records', () => {
  const widgetSrc = readFileSync(resolve(import.meta.dir, '../widgets/log/widget.ts'), 'utf8');
  const onMouseStart = widgetSrc.indexOf('onMouse(ev, state, _ctx)');
  const onMouseEnd = widgetSrc.indexOf('onStateChange(prev, next, ctx)', onMouseStart);
  const onMouse = onMouseStart >= 0 && onMouseEnd > onMouseStart
    ? widgetSrc.slice(onMouseStart, onMouseEnd)
    : '';
  let restore: (() => void) | undefined;

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  test('imports debug the same way other root widgets do and keeps arrival ungated', () => {
    expect(widgetSrc).toContain("import { debug } from '../../src/debug/log.js';");
    expect(onMouse).not.toMatch(/if\s*\(\s*debug\.enabled\s*\)/);
    const events = [...onMouse.matchAll(/debug\.log\('log\.mouse', '([^']+)'/g)].map((m) => m[1]);
    expect(events).toEqual([
      'not-click',
      'missing-click-deps',
      'title-row',
      'mapped-index',
      'mapped-index-negative',
      'row-fallback',
    ]);
    const fallback = onMouse.slice(
      onMouse.indexOf("debug.log('log.mouse', 'row-fallback'"),
      onMouse.indexOf('tryAttachmentHitAtBodyRow'),
    );
    expect(fallback).toContain('row: ev.row');
    expect(fallback).toContain('col: ev.col');
    expect(fallback).toContain('rowInBody');
  });

  test('non-click events record not-click and still return {type: "none"}', () => {
    const cap = observeLogMouseInStore();
    restore = cap.restore;
    const h = makeDeps({ withAttachmentAtLine: 99 });
    const state = baseState({ clickDeps: h.deps, lastRenderOriginRow: 5, lastRenderOriginCol: 1 });
    expect(debug.enabled).toBe(false);
    expect(debug.isFileEnabled()).toBe(true);
    const action = logWidget.onMouse!({ type: 'scroll-up', row: 5, col: 10 }, state, fakeCtx as never);
    expect(action).toEqual({ type: 'none' });
    expect(h.pushModalCalls).toBe(0);
    expect(cap.records()).toEqual([{ category: 'log.mouse', event: 'not-click', data: { type: 'scroll-up' } }]);
  });

  test('missing clickDeps records missing-click-deps and still returns {type: "none"}', () => {
    const cap = observeLogMouseInStore();
    restore = cap.restore;
    const state = baseState({ clickDeps: null });
    expect(debug.enabled).toBe(false);
    const action = logWidget.onMouse!({ type: 'click', row: 5, col: 10 }, state, fakeCtx as never);
    expect(action).toEqual({ type: 'none' });
    expect(cap.records().map((r) => r.event)).toEqual(['missing-click-deps']);
  });

  test('title-row click records title-row with row and rowInBody', () => {
    const cap = observeLogMouseInStore();
    restore = cap.restore;
    const h = makeDeps({ withAttachmentAtLine: 99 });
    const state = baseState({ clickDeps: h.deps, lastRenderOriginRow: 5 });
    const action = logWidget.onMouse!({ type: 'click', row: 0, col: 10 }, state, fakeCtx as never);
    expect(action).toEqual({ type: 'none' });
    expect(h.pushModalCalls).toBe(0);
    expect(cap.records()).toEqual([{
      category: 'log.mouse',
      event: 'title-row',
      data: { row: 0, rowInBody: -1 },
    }]);
  });

  test('mapped index lookup records mapped-index including the index', () => {
    const cap = observeLogMouseInStore();
    restore = cap.restore;
    const h = makeDeps({ withAttachmentAtLine: 99 });
    const state = baseState({
      clickDeps: h.deps,
      lastRenderOriginRow: 5,
      lastRenderOriginCol: 1,
      lastVisibleLineIndices: [99],
    });
    const action = logWidget.onMouse!({ type: 'click', row: 1, col: 10 }, state, fakeCtx as never);
    expect(action).toEqual({ type: 'none' });
    expect(h.pushModalCalls).toBe(1);
    expect(cap.records()).toEqual([{
      category: 'log.mouse',
      event: 'mapped-index',
      data: {
        index: 99,
        row: 1,
        rowInBody: 0,
        tableLength: 1,
        scrollOffset: -1,
        tail: true,
        tablePrefix: [99],
        prefixCap: MAPPED_INDEX_TABLE_PREFIX_CAP,
        prefixTruncated: false,
        originRow: 5,
      },
    }]);
  });

  test('negative mapped index records mapped-index-negative with the index and returns none', () => {
    const cap = observeLogMouseInStore();
    restore = cap.restore;
    const h = makeDeps({ withAttachmentAtLine: 99 });
    const state = baseState({
      clickDeps: h.deps,
      lastRenderOriginRow: 5,
      lastVisibleLineIndices: [-1],
    });
    expect(debug.enabled).toBe(false);
    const action = logWidget.onMouse!({ type: 'click', row: 1, col: 10 }, state, fakeCtx as never);
    expect(action).toEqual({ type: 'none' });
    expect(h.pushModalCalls).toBe(0);
    expect(cap.records()).toEqual([
      {
        category: 'log.mouse',
        event: 'mapped-index',
        data: {
          index: -1,
          row: 1,
          rowInBody: 0,
          tableLength: 1,
          scrollOffset: -1,
          tail: true,
          tablePrefix: [-1],
          prefixCap: MAPPED_INDEX_TABLE_PREFIX_CAP,
          prefixTruncated: false,
          originRow: 5,
        },
      },
      { category: 'log.mouse', event: 'mapped-index-negative', data: { index: -1 } },
    ]);
  });

  test('absent index table records row-fallback and still runs row-based dispatch', () => {
    const cap = observeLogMouseInStore();
    restore = cap.restore;
    const h = makeDeps({ withAttachmentAtLine: 99 });
    const state = baseState({
      lines: Array.from({ length: 100 }, (_, i) => `l${i}`),
      clickDeps: h.deps,
      lastRenderOriginRow: 5,
      lastRenderOriginCol: 1,
    });
    const action = logWidget.onMouse!({ type: 'click', row: 17, col: 10 }, state, fakeCtx as never);
    expect(action).toEqual({ type: 'none' });
    expect(h.pushModalCalls).toBe(1);
    expect(cap.records()).toEqual([{
      category: 'log.mouse',
      event: 'row-fallback',
      data: { row: 17, col: 10, rowInBody: 16 },
    }]);
  });

  test('successful mapping observation alone reproduces body row and table value at that slot', () => {
    const cap = observeLogMouseInStore();
    restore = cap.restore;
    const h = makeDeps({ withAttachmentAtLine: 42 });
    const table = [10, 42, 77];
    const state = baseState({
      clickDeps: h.deps,
      lastRenderOriginRow: 5,
      lastRenderOriginCol: 1,
      lastVisibleLineIndices: table,
    });
    const action = logWidget.onMouse!({ type: 'click', row: 2, col: 10 }, state, fakeCtx as never);
    expect(action).toEqual({ type: 'none' });
    const records = cap.records();
    expect(records).toHaveLength(1);
    expect(records[0]!.event).toBe('mapped-index');
    const data = records[0]!.data as Record<string, unknown>;
    expect(data.row).toBe(2);
    expect(data.rowInBody).toBe(1);
    expect(data.index).toBe(42);
    expect(data.tableLength).toBe(table.length);
    expect(data.tablePrefix).toEqual([10, 42, 77]);
    expect(data.index).toBe(42);
  });

  test('table longer than prefix cap records prefixTruncated true and a bounded prefix', () => {
    const cap = observeLogMouseInStore();
    restore = cap.restore;
    const h = makeDeps({ withAttachmentAtLine: 0 });
    const table = Array.from({ length: MAPPED_INDEX_TABLE_PREFIX_CAP + 4 }, (_, i) => i);
    const state = baseState({
      clickDeps: h.deps,
      lastRenderOriginRow: 5,
      lastRenderOriginCol: 1,
      lastVisibleLineIndices: table,
    });
    logWidget.onMouse!({ type: 'click', row: 1, col: 10 }, state, fakeCtx as never);
    const records = cap.records();
    expect(records).toHaveLength(1);
    expect(records[0]!.event).toBe('mapped-index');
    const data = records[0]!.data as Record<string, unknown>;
    expect(data.tableLength).toBe(table.length);
    expect(data.prefixCap).toBe(MAPPED_INDEX_TABLE_PREFIX_CAP);
    expect(data.prefixTruncated).toBe(true);
    expect(data.tablePrefix).toEqual(table.slice(0, MAPPED_INDEX_TABLE_PREFIX_CAP));
    expect((data.tablePrefix as number[]).length).toBe(MAPPED_INDEX_TABLE_PREFIX_CAP);
    expect((data.tablePrefix as number[]).length).toBeLessThan(data.tableLength as number);
  });

  test('tail and non-tail scroll states are distinct values on mapped-index', () => {
    const cap = observeLogMouseInStore();
    restore = cap.restore;
    const h = makeDeps({ withAttachmentAtLine: 7 });
    const table = [7];
    const tailState = baseState({
      clickDeps: h.deps,
      scrollOffset: -1,
      lastRenderOriginRow: 5,
      lastRenderOriginCol: 1,
      lastVisibleLineIndices: table,
    });
    logWidget.onMouse!({ type: 'click', row: 1, col: 10 }, tailState, fakeCtx as never);
    const nonTailState = baseState({
      clickDeps: h.deps,
      scrollOffset: 3,
      lastRenderOriginRow: 5,
      lastRenderOriginCol: 1,
      lastVisibleLineIndices: table,
    });
    logWidget.onMouse!({ type: 'click', row: 1, col: 10 }, nonTailState, fakeCtx as never);
    const records = cap.records().filter((r) => r.event === 'mapped-index');
    expect(records).toHaveLength(2);
    const tailData = records[0]!.data as Record<string, unknown>;
    const nonTailData = records[1]!.data as Record<string, unknown>;
    expect(tailData.tail).toBe(true);
    expect(tailData.scrollOffset).toBe(-1);
    expect(nonTailData.tail).toBe(false);
    expect(nonTailData.scrollOffset).toBe(3);
    expect(tailData.tail).not.toBe(nonTailData.tail);
    expect(tailData.scrollOffset).not.toBe(nonTailData.scrollOffset);
  });

  test('non-click mouse events do not emit mapping context and keep the existing not-click record', () => {
    const cap = observeLogMouseInStore();
    restore = cap.restore;
    const h = makeDeps({ withAttachmentAtLine: 99 });
    const state = baseState({
      clickDeps: h.deps,
      lastRenderOriginRow: 5,
      lastRenderOriginCol: 1,
      lastVisibleLineIndices: [99],
    });
    const action = logWidget.onMouse!({ type: 'scroll-up', row: 1, col: 10 }, state, fakeCtx as never);
    expect(action).toEqual({ type: 'none' });
    expect(h.pushModalCalls).toBe(0);
    const records = cap.records();
    expect(records).toEqual([{ category: 'log.mouse', event: 'not-click', data: { type: 'scroll-up' } }]);
    expect(records.some((r) => r.event === 'mapped-index')).toBe(false);
    expect(records[0]!.data).not.toHaveProperty('tablePrefix');
    expect(records[0]!.data).not.toHaveProperty('rowInBody');
    expect(records[0]!.data).not.toHaveProperty('prefixTruncated');
  });

  test('missing table entry still records row-fallback and still runs row-based dispatch', () => {
    const cap = observeLogMouseInStore();
    restore = cap.restore;
    const h = makeDeps({ withAttachmentAtLine: 99 });
    const state = baseState({
      lines: Array.from({ length: 100 }, (_, i) => `l${i}`),
      clickDeps: h.deps,
      lastRenderOriginRow: 5,
      lastRenderOriginCol: 1,
      lastVisibleLineIndices: [0, 1],
    });
    const action = logWidget.onMouse!({ type: 'click', row: 17, col: 10 }, state, fakeCtx as never);
    expect(action).toEqual({ type: 'none' });
    expect(h.pushModalCalls).toBe(1);
    expect(cap.records()).toEqual([{
      category: 'log.mouse',
      event: 'row-fallback',
      data: { row: 17, col: 10, rowInBody: 16 },
    }]);
  });

  test('adding mapping context leaves return value and downstream dispatch unchanged', () => {
    const cap = observeLogMouseInStore();
    restore = cap.restore;
    const h = makeDeps({ withAttachmentAtLine: 99 });
    const state = baseState({
      clickDeps: h.deps,
      lastRenderOriginRow: 5,
      lastRenderOriginCol: 1,
      lastVisibleLineIndices: [99],
    });
    const action = logWidget.onMouse!({ type: 'click', row: 1, col: 10 }, state, fakeCtx as never);
    expect(action).toEqual({ type: 'none' });
    expect(h.pushModalCalls).toBe(1);
    expect(h.setFocusCalls).toEqual([]);
    const records = cap.records();
    expect(records.map((r) => r.event)).toEqual(['mapped-index']);
    expect((records[0]!.data as Record<string, unknown>).index).toBe(99);
  });

  test('click after render stores originRow as the stored start row, unchanged', () => {
    const cap = observeLogMouseInStore();
    restore = cap.restore;
    const h = makeDeps({ withAttachmentAtLine: 99 });
    const state = baseState({
      clickDeps: h.deps,
    });
    const renderCtx = {
      width: 80,
      height: 20,
      focused: true,
      originRow: 12,
      originCol: 3,
    };
    logWidget.render!(state, renderCtx as never, 'Log');
    expect(state.lastRenderOriginRow).toBe(12);
    state.lastVisibleLineIndices = [99];
    const action = logWidget.onMouse!({ type: 'click', row: 1, col: 10 }, state, fakeCtx as never);
    expect(action).toEqual({ type: 'none' });
    const records = cap.records().filter((r) => r.event === 'mapped-index');
    expect(records).toHaveLength(1);
    const data = records[0]!.data as Record<string, unknown>;
    expect(data.originRow).toBe(12);
    expect(data.originRow).toBe(state.lastRenderOriginRow);
    expect(data.originRow).not.toBe(1);
  });

  test('click without a stored origin records origin absence, not the popup fallback', () => {
    const cap = observeLogMouseInStore();
    restore = cap.restore;
    const h = makeDeps({ withAttachmentAtLine: 99 });
    const state = baseState({
      clickDeps: h.deps,
      lastVisibleLineIndices: [99],
    });
    expect(state.lastRenderOriginRow).toBeUndefined();
    const action = logWidget.onMouse!({ type: 'click', row: 1, col: 10 }, state, fakeCtx as never);
    expect(action).toEqual({ type: 'none' });
    const records = cap.records().filter((r) => r.event === 'mapped-index');
    expect(records).toHaveLength(1);
    const data = records[0]!.data as Record<string, unknown>;
    expect(data).toHaveProperty('originRow');
    expect(data.originRow).toBeNull();
    expect(data.originRow).not.toBe(1);
    expect(data.originRow).not.toBe(state.lastRenderOriginRow ?? 1);
  });

  test('non-click mouse events do not emit originRow and keep the existing not-click record', () => {
    const cap = observeLogMouseInStore();
    restore = cap.restore;
    const h = makeDeps({ withAttachmentAtLine: 99 });
    const state = baseState({
      clickDeps: h.deps,
      lastRenderOriginRow: 5,
      lastRenderOriginCol: 1,
      lastVisibleLineIndices: [99],
    });
    const action = logWidget.onMouse!({ type: 'scroll-up', row: 1, col: 10 }, state, fakeCtx as never);
    expect(action).toEqual({ type: 'none' });
    expect(h.pushModalCalls).toBe(0);
    const records = cap.records();
    expect(records).toEqual([{ category: 'log.mouse', event: 'not-click', data: { type: 'scroll-up' } }]);
    expect(records[0]!.data).not.toHaveProperty('originRow');
  });

  test('title-row click records and return stay unchanged when origin is observed on mapped clicks', () => {
    const cap = observeLogMouseInStore();
    restore = cap.restore;
    const h = makeDeps({ withAttachmentAtLine: 99 });
    const state = baseState({ clickDeps: h.deps, lastRenderOriginRow: 5 });
    const action = logWidget.onMouse!({ type: 'click', row: 0, col: 10 }, state, fakeCtx as never);
    expect(action).toEqual({ type: 'none' });
    expect(h.pushModalCalls).toBe(0);
    expect(cap.records()).toEqual([{
      category: 'log.mouse',
      event: 'title-row',
      data: { row: 0, rowInBody: -1 },
    }]);
  });

  test('unmapped table click records and path stay unchanged when origin is observed on mapped clicks', () => {
    const cap = observeLogMouseInStore();
    restore = cap.restore;
    const h = makeDeps({ withAttachmentAtLine: 99 });
    const state = baseState({
      lines: Array.from({ length: 100 }, (_, i) => `l${i}`),
      clickDeps: h.deps,
      lastRenderOriginRow: 5,
      lastRenderOriginCol: 1,
      lastVisibleLineIndices: [0, 1],
    });
    const action = logWidget.onMouse!({ type: 'click', row: 17, col: 10 }, state, fakeCtx as never);
    expect(action).toEqual({ type: 'none' });
    expect(h.pushModalCalls).toBe(1);
    expect(cap.records()).toEqual([{
      category: 'log.mouse',
      event: 'row-fallback',
      data: { row: 17, col: 10, rowInBody: 16 },
    }]);
  });

  test('adding origin observation leaves popup coordinates and dispatch unchanged', () => {
    const cap = observeLogMouseInStore();
    restore = cap.restore;
    const h = makeDeps({ withAttachmentAtLine: 99 });
    const attachment = [...h.deps.contextRegistry.attachments.values()][0]!;
    const expectedAbs = { row: 5 + 1, col: 1 + 10 };
    const reference = createAttachmentPopup({
      attachment,
      col: expectedAbs.col,
      row: expectedAbs.row,
      termCols: 120,
      termRows: 40,
      onAction: () => {},
    });
    const mounted: Array<{ row: number; col: number; width: number; height: number }> = [];
    const innerPush = h.deps.pushModal;
    h.deps.pushModal = (handle) => {
      mounted.push({ ...handle.surface.bounds });
      innerPush(handle);
    };
    const state = baseState({
      clickDeps: h.deps,
      lastRenderOriginRow: 5,
      lastRenderOriginCol: 1,
      lastVisibleLineIndices: [99],
    });
    const action = logWidget.onMouse!({ type: 'click', row: 1, col: 10 }, state, fakeCtx as never);
    expect(action).toEqual({ type: 'none' });
    expect(h.pushModalCalls).toBe(1);
    expect(h.setFocusCalls).toEqual([]);
    expect(mounted).toHaveLength(1);
    expect(mounted[0]).toEqual({ ...reference.surface.bounds });
    const records = cap.records();
    expect(records.map((r) => r.event)).toEqual(['mapped-index']);
    expect((records[0]!.data as Record<string, unknown>).originRow).toBe(5);
  });
});

describe('wd-log widget · render origin observation', () => {
  const widgetSrc = readFileSync(resolve(import.meta.dir, '../widgets/log/widget.ts'), 'utf8');
  const renderStart = widgetSrc.indexOf('render(state, ctx)');
  const renderEnd = widgetSrc.indexOf('onMouse(ev, state, _ctx)', renderStart);
  const render = renderStart >= 0 && renderEnd > renderStart
    ? widgetSrc.slice(renderStart, renderEnd)
    : '';
  let restore: (() => void) | undefined;

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  test('keeps dashboard.chat.stream / wd-log.render and does not compute originRow', () => {
    expect(render).toContain("debug.log('dashboard.chat.stream', 'wd-log.render'");
    expect(render).toContain('originRow: state.lastRenderOriginRow ?? null');
    expect(render).not.toMatch(/originRow\s*[:=]\s*ctx\.originRow/);
    expect(render).not.toMatch(/originRow\s*[:=]\s*\(/);
    expect(widgetSrc).toContain("import { debug } from '../../src/debug/log.js';");
  });

  test('render with originRow 3 records that stored start row unchanged', () => {
    const cap = observeWdLogRenderInStore();
    restore = cap.restore;
    const state = baseState();
    logWidget.render!(state, renderCtx({ originRow: 3, originCol: 1 }) as never, 'Log');
    expect(state.lastRenderOriginRow).toBe(3);
    const records = cap.records().filter((r) => r.event === 'wd-log.render');
    expect(records).toHaveLength(1);
    expect(records[0]!.category).toBe('dashboard.chat.stream');
    const data = records[0]!.data as Record<string, unknown>;
    expect(data.originRow).toBe(3);
    expect(data.originRow).toBe(state.lastRenderOriginRow);
    expect(data.originRow).not.toBe(1);
  });

  test('originRow 1 and originRow 3 produce distinct render observation values', () => {
    const cap = observeWdLogRenderInStore();
    restore = cap.restore;
    const one = baseState();
    logWidget.render!(one, renderCtx({ originRow: 1, originCol: 1 }) as never, 'Log');
    const three = baseState();
    logWidget.render!(three, renderCtx({ originRow: 3, originCol: 1 }) as never, 'Log');
    const records = cap.records().filter((r) => r.event === 'wd-log.render');
    expect(records).toHaveLength(2);
    const first = records[0]!.data as Record<string, unknown>;
    const second = records[1]!.data as Record<string, unknown>;
    expect(first.originRow).toBe(1);
    expect(second.originRow).toBe(3);
    expect(first.originRow).not.toBe(second.originRow);
  });

  test('missing originRow records absence, not the popup fallback of 1', () => {
    const cap = observeWdLogRenderInStore();
    restore = cap.restore;
    const state = baseState();
    expect(state.lastRenderOriginRow).toBeUndefined();
    logWidget.render!(state, renderCtx() as never, 'Log');
    expect(state.lastRenderOriginRow).toBeUndefined();
    const records = cap.records().filter((r) => r.event === 'wd-log.render');
    expect(records).toHaveLength(1);
    const data = records[0]!.data as Record<string, unknown>;
    expect(data).toHaveProperty('originRow');
    expect(data.originRow).toBeNull();
    expect(data.originRow).not.toBe(1);
    expect(data.originRow).not.toBe(state.lastRenderOriginRow ?? 1);
  });

  test('origin observation still records when debug.enabled is off', () => {
    const cap = observeWdLogRenderInStore();
    restore = cap.restore;
    expect(debug.enabled).toBe(false);
    const state = baseState();
    expect(state.lastRenderOriginRow).toBeUndefined();
    logWidget.render!(state, renderCtx({ originRow: 3, originCol: 1 }) as never, 'Log');
    expect(state.lastRenderOriginRow).toBe(3);
    const records = cap.records().filter((r) => r.event === 'wd-log.render');
    expect(records).toHaveLength(1);
    expect((records[0]!.data as Record<string, unknown>).originRow).toBe(3);
    expect((records[0]!.data as Record<string, unknown>).originRow).toBe(state.lastRenderOriginRow);
  });

  test('the other nine fields stay gated when debug.enabled is off', () => {
    const cap = observeWdLogRenderInStore();
    restore = cap.restore;
    expect(debug.enabled).toBe(false);
    const state = baseState({ lines: ['a', 'b'] });
    logWidget.render!(state, renderCtx({ originRow: 3, originCol: 1 }) as never, 'Log');
    expect(state.lastRenderOriginRow).toBe(3);
    const records = cap.records().filter((r) => r.event === 'wd-log.render');
    expect(records).toHaveLength(1);
    const data = records[0]!.data as Record<string, unknown>;
    expect(data.originRow).toBe(3);
    for (const field of WD_LOG_RENDER_NINE_FIELDS) {
      expect(data).not.toHaveProperty(field);
    }
  });

  test('the other nine fields still appear when debug.enabled is on', () => {
    const cap = observeWdLogRenderInStore();
    restore = cap.restore;
    debug.setDiagEnabled(true);
    expect(debug.enabled).toBe(true);
    const state = baseState({ lines: ['a', 'b'] });
    const ctx = renderCtx({ originRow: 3, originCol: 1, width: 80, height: 20 });
    logWidget.render!(state, ctx as never, 'Log');
    const records = cap.records().filter((r) => r.event === 'wd-log.render');
    expect(records).toHaveLength(1);
    const data = records[0]!.data as Record<string, unknown>;
    expect(data.originRow).toBe(3);
    expect(data.ctxHeight).toBe(20);
    expect(data.ctxWidth).toBe(80);
    expect(data.stateLinesLen).toBe(2);
    expect(data.scrollOffset).toBe(-1);
    expect(data.hasFooter).toBe(false);
    expect(typeof data.bodyLineCount).toBe('number');
    expect(typeof data.visibleLineIndicesCount).toBe('number');
    expect(typeof data.firstVisibleIdx).toBe('number');
    expect(typeof data.lastVisibleIdx).toBe('number');
  });

  test('adding origin observation leaves returned render lines unchanged', () => {
    const cap = observeWdLogRenderInStore();
    restore = cap.restore;
    const stateA = baseState({ lines: ['hello', 'world'] });
    const stateB = baseState({ lines: ['hello', 'world'] });
    const ctx = renderCtx({ originRow: 3, originCol: 1 });
    const linesA = logWidget.render!(stateA, ctx as never, 'Log');
    const linesB = logWidget.render!(stateB, ctx as never, 'Log');
    expect(linesA).toEqual(linesB);
    expect(Array.isArray(linesA)).toBe(true);
    expect(linesA.length).toBeGreaterThan(0);
    const records = cap.records().filter((r) => r.event === 'wd-log.render');
    expect(records).toHaveLength(2);
    expect((records[0]!.data as Record<string, unknown>).originRow).toBe(3);
  });
});
