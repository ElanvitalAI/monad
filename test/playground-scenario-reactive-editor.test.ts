// F-B5a — Reactive YAML editor tests.

import { describe, expect, test } from 'bun:test';

import {
  ReactiveScenarioEditor,
  type ReactiveEditorTimer,
  type ScenarioParseResult,
} from '../src/playground-scenario/index.js';

class VirtualTimer implements ReactiveEditorTimer {
  private next = 1;
  private scheduled = new Map<number, { at: number; fn: () => void }>();
  public now = 0;

  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.next++;
    this.scheduled.set(id, { at: this.now + ms, fn });
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.scheduled.delete(handle as number);
  }
  advance(ms: number): void {
    this.now += ms;
    const due = [...this.scheduled.entries()]
      .filter(([, e]) => e.at <= this.now)
      .sort((a, b) => a[1].at - b[1].at);
    for (const [id, entry] of due) {
      this.scheduled.delete(id);
      entry.fn();
    }
  }
}

describe('ReactiveScenarioEditor — debounce', () => {
  test('setSource schedules parse after debounceMs', () => {
    const timer = new VirtualTimer();
    const seen: ScenarioParseResult[] = [];
    const editor = new ReactiveScenarioEditor({
      timer, debounceMs: 250,
      onScenarioChange: (r) => { seen.push(r); },
    });
    editor.setSource('id: x\ntitle: y\n');
    expect(seen.length).toBe(0);     // not yet — still within debounce
    timer.advance(249);
    expect(seen.length).toBe(0);
    timer.advance(1);
    expect(seen.length).toBe(1);
    expect(seen[0]!.scenario?.id).toBe('x');
  });

  test('rapid setSource collapses to one parse', () => {
    const timer = new VirtualTimer();
    let calls = 0;
    const editor = new ReactiveScenarioEditor({
      timer, debounceMs: 250,
      onScenarioChange: () => { calls++; },
    });
    editor.setSource('a: 1');
    timer.advance(100);
    editor.setSource('a: 2');
    timer.advance(100);
    editor.setSource('a: 3');
    timer.advance(100);
    expect(calls).toBe(0);
    timer.advance(150);
    expect(calls).toBe(1);
  });

  test('flush parses immediately and cancels pending', () => {
    const timer = new VirtualTimer();
    const seen: ScenarioParseResult[] = [];
    const editor = new ReactiveScenarioEditor({
      timer, debounceMs: 250,
      onScenarioChange: (r) => { seen.push(r); },
    });
    editor.setSource('id: a\ntitle: b\n');
    const r = editor.flush();
    expect(seen.length).toBe(1);
    expect(r.scenario?.id).toBe('a');
    // Subsequent timer advance should fire nothing else.
    timer.advance(1000);
    expect(seen.length).toBe(1);
  });
});

describe('ReactiveScenarioEditor — diff gating', () => {
  test('semantically-equal edits do not re-notify', () => {
    const timer = new VirtualTimer();
    let calls = 0;
    const editor = new ReactiveScenarioEditor({
      timer, debounceMs: 0,
      onScenarioChange: () => { calls++; },
    });
    editor.setSource('id: x\ntitle: y\n');
    timer.advance(1);
    expect(calls).toBe(1);
    // Add trailing newline + comment — same parse, no new call.
    editor.setSource('id: x\ntitle: y\n# comment\n\n');
    timer.advance(1);
    expect(calls).toBe(1);
  });

  test('real scenario change notifies', () => {
    const timer = new VirtualTimer();
    let calls = 0;
    const editor = new ReactiveScenarioEditor({
      timer, debounceMs: 0,
      onScenarioChange: () => { calls++; },
    });
    editor.setSource('id: x\ntitle: y\n');
    timer.advance(1);
    editor.setSource('id: x\ntitle: DIFFERENT\n');
    timer.advance(1);
    expect(calls).toBe(2);
  });

  test('new errors notify even when scenario unchanged', () => {
    const timer = new VirtualTimer();
    let calls = 0;
    let lastResult: ScenarioParseResult | null = null;
    const editor = new ReactiveScenarioEditor({
      timer, debounceMs: 0,
      onScenarioChange: (r) => { calls++; lastResult = r; },
    });
    editor.setSource('id: x\ntitle: y\nsteps:\n  - action: wait\n    ms: 5\n');
    timer.advance(1);
    const step0Calls = calls;
    // Introduce a malformed step — scenario.id/title same, errors shift.
    editor.setSource('id: x\ntitle: y\nsteps:\n  - action: teleport\n');
    timer.advance(1);
    expect(calls).toBeGreaterThan(step0Calls);
    expect(lastResult!.errors.length).toBeGreaterThan(0);
  });
});

describe('ReactiveScenarioEditor — lifecycle', () => {
  test('initialSource parses synchronously during construction', () => {
    const timer = new VirtualTimer();
    const seen: ScenarioParseResult[] = [];
    const editor = new ReactiveScenarioEditor({
      timer, debounceMs: 250,
      initialSource: 'id: boot\ntitle: Boot\n',
      onScenarioChange: (r) => { seen.push(r); },
    });
    expect(seen.length).toBe(1);
    expect(seen[0]!.scenario?.id).toBe('boot');
    expect(editor.getLastResult()!.scenario?.id).toBe('boot');
  });

  test('dispose prevents future onChange notifications', () => {
    const timer = new VirtualTimer();
    let calls = 0;
    const editor = new ReactiveScenarioEditor({
      timer, debounceMs: 100,
      onScenarioChange: () => { calls++; },
    });
    editor.setSource('id: x\ntitle: y\n');
    editor.dispose();
    timer.advance(500);
    expect(calls).toBe(0);
  });

  test('setSource after dispose is a no-op', () => {
    const timer = new VirtualTimer();
    let calls = 0;
    const editor = new ReactiveScenarioEditor({
      timer, debounceMs: 0,
      onScenarioChange: () => { calls++; },
    });
    editor.dispose();
    editor.setSource('id: x\ntitle: y\n');
    timer.advance(1);
    expect(calls).toBe(0);
  });
});
