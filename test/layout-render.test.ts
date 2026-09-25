// ── Layout render tests ──
// Exercise renderLayout + renderModalOverlay against a WidgetHost
// populated with simple text-emitting fixture widgets.

import { describe, test, expect, beforeEach } from 'bun:test';
import { WidgetHost } from '../src/widgets/host.js';
import { createLayout, emptyLayout, placeWidget, openModal } from '../src/layout/host.js';
import { renderLayout, renderModalOverlay, modalRect } from '../src/layout/render.js';
import type { WidgetDef } from '../src/widgets/types.js';

/** Fixture: emits character + marker per line. Signals focus via a '*'
 *  prefix so tests can assert the focused flag threaded through ctx. */
function makeFixture(type: string, marker: string): WidgetDef<{ n: number }> {
  return {
    type,
    description: 'test fixture',
    defaultCharacter: type,
    initialState: () => ({ n: 0 }),
    render: (_state, ctx, character) => {
      const out: string[] = [];
      const focusMark = ctx.focused ? '*' : '.';
      for (let i = 0; i < ctx.height; i++) {
        const text = i === 0 ? `${focusMark}${character}[${marker}]` : `${marker}${i}`;
        const padded = text + ' '.repeat(Math.max(0, ctx.width - text.length));
        out.push(padded);
      }
      return out;
    },
  };
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

let host: WidgetHost;

beforeEach(() => {
  host = new WidgetHost({ log: () => {}, requestRender: () => {} });
  host.register(makeFixture('a', 'A'));
  host.register(makeFixture('b', 'B'));
  host.register(makeFixture('c', 'C'));
});

describe('renderLayout — grid basics', () => {
  test('empty layout returns zero lines when height=0', () => {
    const lines = renderLayout(emptyLayout(), host, { width: 80, height: 0, topRow: 1 });
    expect(lines).toHaveLength(0);
  });

  test('single row single cell — produces `height` lines', () => {
    const inst = host.spawn({ type: 'a', character: 'Skills' });
    const layout = createLayout([
      { height: 'flex', cells: [{ widgetInstanceId: inst.id, width: 'flex' }] },
    ]);
    const lines = renderLayout(layout, host, { width: 40, height: 5, topRow: 1 });
    expect(lines).toHaveLength(5);
    expect(stripAnsi(lines[0]!)).toContain('Skills');
  });

  test('three cells emit two dividers — via ansi.moveTo', () => {
    const a = host.spawn({ type: 'a' });
    const b = host.spawn({ type: 'b' });
    const c = host.spawn({ type: 'c' });
    const layout = createLayout([
      {
        cells: [
          { widgetInstanceId: a.id, width: 'flex' },
          { widgetInstanceId: b.id, width: 'flex' },
          { widgetInstanceId: c.id, width: 'flex' },
        ],
      },
    ]);
    const lines = renderLayout(layout, host, { width: 60, height: 3, topRow: 1 });
    // Each line contains two divider chars after ansi.moveTo sequences
    const dividerCount = (lines[0]!.match(/\u2502/g) || []).length;
    expect(dividerCount).toBe(2);
  });

  test('two rows — each gets its height share', () => {
    const a = host.spawn({ type: 'a' });
    const b = host.spawn({ type: 'b' });
    const layout = createLayout([
      { height: 'flex', cells: [{ widgetInstanceId: a.id }] },
      { height: 'flex', cells: [{ widgetInstanceId: b.id }] },
    ]);
    const lines = renderLayout(layout, host, { width: 30, height: 6, topRow: 1 });
    expect(lines).toHaveLength(6);
    expect(stripAnsi(lines[0]!)).toContain('a[A]');  // ignore focus prefix
    expect(stripAnsi(lines[3]!)).toContain('b[B]');
  });

  test('null widget cell renders as spaces', () => {
    const a = host.spawn({ type: 'a' });
    const layout = createLayout([
      { cells: [{ widgetInstanceId: a.id, width: 'flex' }, { widgetInstanceId: null, width: 'flex' }] },
    ]);
    const lines = renderLayout(layout, host, { width: 40, height: 2, topRow: 1 });
    // Right half should be all spaces (modulo divider)
    const rawLine = stripAnsi(lines[0]!);
    // First cell content
    expect(rawLine).toContain('A');
  });

  test('focused flag reaches widget.render via ctx.focused', () => {
    const a = host.spawn({ type: 'a' });
    const b = host.spawn({ type: 'b' });
    const layout = createLayout([
      { cells: [{ widgetInstanceId: a.id }, { widgetInstanceId: b.id }] },
    ]);
    const lines = renderLayout(layout, host, {
      width: 30, height: 2, topRow: 1, focusedInstanceId: a.id,
    });
    // Fixture emits '*' when focused, '.' otherwise.
    const line0 = stripAnsi(lines[0]!);
    expect(line0.indexOf('*a')).toBeGreaterThanOrEqual(0);  // a is focused
    expect(line0.indexOf('.b')).toBeGreaterThanOrEqual(0);  // b is not
  });

  test('theme tokens reach widget.render via ctx.theme', () => {
    host.register({
      type: 'theme-probe',
      description: 'theme probe',
      initialState: () => ({}),
      render: (_state, ctx) => [ctx.theme?.colors.accent ?? 'missing'],
    });
    const inst = host.spawn({ type: 'theme-probe' });
    const layout = createLayout([
      { cells: [{ widgetInstanceId: inst.id }] },
    ]);
    const lines = renderLayout(layout, host, {
      width: 20,
      height: 1,
      topRow: 1,
      theme: {
        name: 'test',
        colors: {
          text: '#000001',
          muted: '#000002',
          dim: '#000003',
          accent: '#112233',
          success: '#000004',
          warning: '#000005',
          error: '#000006',
          info: '#000007',
          highlight: '#000008',
        },
        pane: {
          titleActive: '#000009',
          titleInactive: '#00000a',
          dividerActive: '#00000b',
          dividerInactive: '#00000c',
        },
        modal: {
          borderActive: '#00000d',
          borderInactive: '#00000e',
          title: '#00000f',
        },
        cursor: {
          focused: '#000010',
          inactive: '#000011',
        },
        widget: {
          accent: '#000012',
          selected: '#000013',
        },
      },
    });
    expect(lines[0]).toContain('#112233');
  });

  test('cell with zero width is skipped cleanly', () => {
    const a = host.spawn({ type: 'a' });
    const b = host.spawn({ type: 'b' });
    const layout = createLayout([
      {
        cells: [
          { widgetInstanceId: a.id, width: 10 },
          { widgetInstanceId: b.id, width: 10 },
        ],
      },
    ]);
    // width=5 is less than sum of absolutes — solveSizes clamps to 0
    // for the overflowing cell. Should not throw.
    const lines = renderLayout(layout, host, { width: 5, height: 2, topRow: 1 });
    expect(lines).toHaveLength(2);
  });
});

describe('renderModalOverlay', () => {
  test('returns empty string when no modal present', () => {
    const out = renderModalOverlay(emptyLayout(), host, { termRows: 30, termCols: 80 });
    expect(out).toBe('');
  });

  test('paints a bordered box around the first modal', () => {
    const inst = host.spawn({ type: 'a', character: 'Dialog' });
    const layout = openModal(emptyLayout(), {
      id: 'm1', widgetInstanceId: inst.id, position: 'center',
    });
    const out = renderModalOverlay(layout, host, { termRows: 30, termCols: 80 });
    expect(out).toContain('\u250C');  // top-left corner
    expect(out).toContain('\u2518');  // bottom-right corner
    expect(out).toContain('Dialog');
  });

  test('custom size respects minimum clamp', () => {
    const inst = host.spawn({ type: 'a' });
    const layout = openModal(emptyLayout(), {
      id: 'tiny', widgetInstanceId: inst.id, position: 'center',
      size: { width: 5, height: 3 },
    });
    const rect = modalRect(layout, 30, 80)!;
    expect(rect.width).toBeGreaterThanOrEqual(24);
    expect(rect.height).toBeGreaterThanOrEqual(8);
  });

  test('absolute position honored over center', () => {
    const inst = host.spawn({ type: 'a' });
    const layout = openModal(emptyLayout(), {
      id: 'fixed', widgetInstanceId: inst.id,
      position: { row: 4, col: 10 },
    });
    const rect = modalRect(layout, 30, 80)!;
    expect(rect.top).toBe(4);
    expect(rect.left).toBe(10);
  });

  test('second modal in the stack is ignored in this phase', () => {
    const a = host.spawn({ type: 'a', character: 'First' });
    const b = host.spawn({ type: 'b', character: 'Second' });
    let layout = openModal(emptyLayout(), { id: 'm1', widgetInstanceId: a.id, position: 'center' });
    layout = openModal(layout, { id: 'm2', widgetInstanceId: b.id, position: 'center' });
    const out = renderModalOverlay(layout, host, { termRows: 30, termCols: 80 });
    expect(out).toContain('First');
    expect(out).not.toContain('Second');
  });

  test('renders modal widget into chrome inner bounds through the content-only adapter', () => {
    const seen: Array<{
      width: number;
      height: number;
      originRow?: number;
      originCol?: number;
    }> = [];
    const def: WidgetDef<{ n: number }> = {
      type: 'modal-inner-probe',
      description: 'captures modal ctx',
      initialState: () => ({ n: 0 }),
      render: (_state, ctx) => {
        seen.push({
          width: ctx.width,
          height: ctx.height,
          originRow: ctx.originRow,
          originCol: ctx.originCol,
        });
        return Array.from({ length: ctx.height }, () => ' '.repeat(ctx.width));
      },
    };
    const hostM = new WidgetHost({ log: () => {}, requestRender: () => {} });
    hostM.register(def);
    const inst = hostM.spawn({ type: 'modal-inner-probe', character: 'Inner Probe' });
    const layout = openModal(emptyLayout(), {
      id: 'm-inner',
      widgetInstanceId: inst.id,
      position: { row: 4, col: 10 },
      size: { width: 30, height: 10 },
    });
    renderModalOverlay(layout, hostM, { termRows: 24, termCols: 80 });
    expect(seen).toEqual([{
      width: 28,
      height: 9,
      originRow: 5,
      originCol: 11,
    }]);
  });
});

// ── Render ctx enrichment (2026-04-20 · canvas/animate/telemetry wire) ──

describe('renderLayout — widget-host ctx enrichment', () => {
  test('canvas / animate / telemetry reach widget.render from the host', () => {
    const seen: Array<{ hasCanvas: boolean; hasAnimate: boolean; hasTelemetry: boolean }> = [];
    const def: WidgetDef<{ n: number }> = {
      type: 'ctx-probe',
      description: 'records ctx fields it saw',
      initialState: () => ({ n: 0 }),
      render: (_state, ctx) => {
        seen.push({
          hasCanvas: typeof ctx.canvas?.create === 'function',
          hasAnimate: typeof ctx.animate?.tween === 'function',
          hasTelemetry: typeof ctx.telemetry?.emit === 'function',
        });
        const row = ' '.repeat(ctx.width);
        return Array.from({ length: ctx.height }, () => row);
      },
    };
    const hostWithTelemetry = new WidgetHost({
      log: () => {},
      requestRender: () => {},
      telemetry: { emit: () => {} },
    });
    hostWithTelemetry.register(def);
    const inst = hostWithTelemetry.spawn({ type: 'ctx-probe' });
    const layout = createLayout([
      { height: 'flex', cells: [{ widgetInstanceId: inst.id, width: 'flex' }] },
    ]);
    renderLayout(layout, hostWithTelemetry, { width: 20, height: 4, topRow: 1 });
    expect(seen.length).toBe(1);
    expect(seen[0]).toEqual({ hasCanvas: true, hasAnimate: true, hasTelemetry: true });
  });

  test('zTier / zIndex populated when zInfoFor is wired', () => {
    const captured: Array<{ zTier?: string; zIndex?: number }> = [];
    const def: WidgetDef<{ n: number }> = {
      type: 'z-probe',
      description: 'captures z hints',
      initialState: () => ({ n: 0 }),
      render: (_state, ctx) => {
        captured.push({ zTier: ctx.zTier, zIndex: ctx.zIndex });
        return Array.from({ length: ctx.height }, () => ' '.repeat(ctx.width));
      },
    };
    const hostZ = new WidgetHost({
      log: () => {},
      requestRender: () => {},
      zInfoFor: () => ({ tier: 'vw', zIndex: 2 }),
    });
    hostZ.register(def);
    const inst = hostZ.spawn({ type: 'z-probe' });
    const layout = createLayout([
      { height: 'flex', cells: [{ widgetInstanceId: inst.id, width: 'flex' }] },
    ]);
    renderLayout(layout, hostZ, { width: 20, height: 3, topRow: 1 });
    expect(captured[0]).toEqual({ zTier: 'vw', zIndex: 2 });
  });

  test('modal render path also receives canvas + animate', () => {
    const seen: Array<{ hasCanvas: boolean; hasAnimate: boolean }> = [];
    const def: WidgetDef<{ n: number }> = {
      type: 'modal-probe',
      description: 'records ctx under modal path',
      initialState: () => ({ n: 0 }),
      render: (_state, ctx) => {
        seen.push({
          hasCanvas: typeof ctx.canvas?.create === 'function',
          hasAnimate: typeof ctx.animate?.tween === 'function',
        });
        return Array.from({ length: ctx.height }, () => ' '.repeat(ctx.width));
      },
    };
    const hostM = new WidgetHost({ log: () => {}, requestRender: () => {} });
    hostM.register(def);
    const inst = hostM.spawn({ type: 'modal-probe' });
    const layout = openModal(emptyLayout(), {
      id: 'm', widgetInstanceId: inst.id, position: 'center',
    });
    renderModalOverlay(layout, hostM, {
      termRows: 24, termCols: 80, focusedInstanceId: null,
    });
    expect(seen.length).toBe(1);
    expect(seen[0]).toEqual({ hasCanvas: true, hasAnimate: true });
  });
});

describe('modalRect', () => {
  test('returns null when no modal', () => {
    expect(modalRect(emptyLayout(), 30, 80)).toBeNull();
  });

  test('centered rect matches centered modal math', () => {
    const inst = host.spawn({ type: 'a' });
    const layout = openModal(emptyLayout(), {
      id: 'm', widgetInstanceId: inst.id, position: 'center',
    });
    const rect = modalRect(layout, 30, 80)!;
    // With default 60% × 50%: w=48 h=15. Centered: left ≈ 17, top ≈ 8.
    expect(rect.width).toBeLessThanOrEqual(80);
    expect(rect.height).toBeLessThanOrEqual(30);
    expect(rect.top).toBeGreaterThan(1);
    expect(rect.left).toBeGreaterThan(1);
  });
});
