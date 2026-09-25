// ProgressBar widget — post-migration test (PR-2 of expression Tier S+A).
//
// Verifies:
//  - The widget delegates the bar string to expression `renderProgress`
//    (raw SGR, chalk-environment-deterministic)
//  - status → AdaptiveColor mapping preserves semantic intent (red for
//    error, amber for review, ...)
//  - layout invariants hold: fixed-row height, percent suffix
//
// We render through a stub `Printer` that captures `text(col, row,
// content)` calls so tests can assert exact cells written.

import { describe, expect, test } from 'bun:test';
import { ProgressBar, type ProgressBarSpec } from '../src/ui/widgets/progress-bar.js';
import type { Printer } from '../src/ui/printer.js';

interface CapturedCall {
  col: number;
  row: number;
  text: string;
}

/** Minimal Printer stub — `draw()` only calls `text(col,row,str)` so we
 *  capture those and stub the rest. Cast through `unknown` to satisfy
 *  the full Printer surface (which has many internal fields we don't
 *  need to exercise). */
class StubPrinter {
  readonly calls: CapturedCall[] = [];
  width = 50;
  height = 2;
  text(col: number, row: number, content: string): this {
    this.calls.push({ col, row, text: content });
    return this;
  }
  // Other Printer methods aren't called by ProgressBar.draw(), so they
  // can stay no-ops. The unknown cast at the call site bypasses the
  // strict Printer-class shape check.
}

function asPrinter(stub: StubPrinter): Printer {
  return stub as unknown as Printer;
}

const stripAnsi = (s: string) => s.replace(/\x1b\[[\d;]*m/g, '');

describe('ProgressBar · migration to renderProgress', () => {
  test('paints exactly one row when no label', () => {
    const bar = new ProgressBar({ total: 100, current: 50 });
    const p = new StubPrinter();
    p.height = 1;
    bar.draw(asPrinter(p));
    // Single text() call expected: bar + percent suffix.
    expect(p.calls.length).toBe(1);
    expect(p.calls[0]!.row).toBe(0);
  });

  test('paints two rows when label present + height >= 2', () => {
    const bar = new ProgressBar({ total: 100, current: 25, label: 'Build' });
    const p = new StubPrinter();
    bar.draw(asPrinter(p));
    expect(p.calls.length).toBe(2);
    expect(p.calls[0]!.row).toBe(0);
    expect(p.calls[0]!.text).toContain('Build');
    expect(p.calls[1]!.row).toBe(1);
  });

  test('percent suffix shows current/total ratio', () => {
    const bar = new ProgressBar({ total: 100, current: 42 });
    const p = new StubPrinter();
    p.height = 1;
    bar.draw(asPrinter(p));
    const stripped = stripAnsi(p.calls[0]!.text);
    expect(stripped).toContain(' 42%');
  });

  test('zero total → 0% percent', () => {
    const bar = new ProgressBar({ total: 0, current: 0 });
    const p = new StubPrinter();
    p.height = 1;
    bar.draw(asPrinter(p));
    const stripped = stripAnsi(p.calls[0]!.text);
    expect(stripped).toContain('  0%');
  });

  test('100% completion fills entire bar (default fillChar = █)', () => {
    const bar = new ProgressBar({ total: 100, current: 100 });
    const p = new StubPrinter();
    p.height = 1;
    p.width = 20;
    bar.draw(asPrinter(p));
    const stripped = stripAnsi(p.calls[0]!.text);
    // Bar width = 20 - 5 (' 100%') = 15 cells of █
    expect(stripped).toContain('█');
    expect(stripped).toContain('100%');
  });

  test('emits raw SGR via expression renderProgress (not chalk passthrough)', () => {
    const bar = new ProgressBar({ total: 100, current: 50 });
    const p = new StubPrinter();
    p.height = 1;
    bar.draw(asPrinter(p));
    // renderProgress always emits truecolor SGR for the fill.
    expect(p.calls[0]!.text).toContain('\x1b[38;2;');
  });

  test('hides percent when showPercent=false', () => {
    const bar = new ProgressBar({ total: 100, current: 50, showPercent: false });
    const p = new StubPrinter();
    p.height = 1;
    bar.draw(asPrinter(p));
    const stripped = stripAnsi(p.calls[0]!.text);
    expect(stripped).not.toContain('%');
  });

  test('zero width / height → no draw calls', () => {
    const bar = new ProgressBar({ total: 100, current: 50 });
    const p1 = new StubPrinter();
    p1.width = 0;
    bar.draw(asPrinter(p1));
    expect(p1.calls.length).toBe(0);

    const p2 = new StubPrinter();
    p2.height = 0;
    bar.draw(asPrinter(p2));
    expect(p2.calls.length).toBe(0);
  });
});

describe('ProgressBar · status semantic colors', () => {
  function getBarSgrPrefix(spec: ProgressBarSpec): string {
    const bar = new ProgressBar(spec);
    const p = new StubPrinter();
    p.height = 1;
    bar.draw(asPrinter(p));
    // Extract first \x1b[38;2;r;g;bm sequence.
    const m = /\x1b\[38;2;(\d+);(\d+);(\d+)m/.exec(p.calls[0]!.text);
    return m ? `${m[1]},${m[2]},${m[3]}` : '';
  }

  test('error status maps to red palette', () => {
    const sgr = getBarSgrPrefix({ total: 100, current: 50, status: 'error' });
    // #f38ba8 → 243,139,168
    expect(sgr).toBe('243,139,168');
  });

  test('review status maps to amber palette', () => {
    const sgr = getBarSgrPrefix({ total: 100, current: 50, status: 'review' });
    // #f9e2af → 249,226,175
    expect(sgr).toBe('249,226,175');
  });

  test('running status maps to blue palette', () => {
    const sgr = getBarSgrPrefix({ total: 100, current: 50, status: 'running' });
    // #89b4fa → 137,180,250
    expect(sgr).toBe('137,180,250');
  });

  test('done / default status maps to green', () => {
    const sgr = getBarSgrPrefix({ total: 100, current: 50, status: 'done' });
    // #a6e3a1 → 166,227,161
    expect(sgr).toBe('166,227,161');
  });

  test('backlog status maps to muted gray', () => {
    const sgr = getBarSgrPrefix({ total: 100, current: 50, status: 'backlog' });
    // #7f849c → 127,132,156
    expect(sgr).toBe('127,132,156');
  });
});

describe('ProgressBar · update API', () => {
  test('update({ current }) advances the bar', () => {
    const bar = new ProgressBar({ total: 100, current: 0 });
    expect(bar.percent).toBe(0);
    bar.update({ current: 50 });
    expect(bar.percent).toBe(50);
  });

  test('update clamps current to [0, total]', () => {
    const bar = new ProgressBar({ total: 100, current: 0 });
    bar.update({ current: 200 });
    expect(bar.percent).toBe(100);
    bar.update({ current: -10 });
    expect(bar.percent).toBe(0);
  });

  test('update({ label }) replaces the label', () => {
    const bar = new ProgressBar({ total: 100, label: 'old' });
    bar.update({ label: 'new' });
    const p = new StubPrinter();
    bar.draw(asPrinter(p));
    expect(p.calls[0]!.text).toContain('new');
  });

  test('update({ total }) re-baselines the percent', () => {
    const bar = new ProgressBar({ total: 100, current: 50 });
    expect(bar.percent).toBe(50);
    bar.update({ total: 200 });
    expect(bar.percent).toBe(25);
  });
});

describe('ProgressBar · misc', () => {
  test('does not take focus', () => {
    const bar = new ProgressBar({ total: 100 });
    expect(bar.takeFocus()).toBe(false);
  });

  test('requiredSize honours label presence', () => {
    const noLabel = new ProgressBar({ total: 100 });
    expect(noLabel.requiredSize({ width: 80, height: 10 })).toEqual({ width: 80, height: 1 });

    const labeled = new ProgressBar({ total: 100, label: 'Building' });
    expect(labeled.requiredSize({ width: 80, height: 10 })).toEqual({ width: 80, height: 2 });
  });

  test('onEvent ignores all events', () => {
    const bar = new ProgressBar({ total: 100 });
    expect(bar.onEvent({ name: 'enter', sequence: '\r', ctrl: false, meta: false, shift: false } as never).kind).toBe('ignored');
  });
});
