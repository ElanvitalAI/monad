// ── Phase F: log adapter + color map tests ──

import { describe, test, expect } from 'bun:test';
import {
  AgentLogAdapter,
  agentCounts,
  hudSummary,
  agentColorNoop,
} from '../src/agent/log-adapter';
import {
  agentColor, agentColorIndex, AGENT_PALETTE_HEX,
} from '../src/agent/color-map';
import type { AgentEvent } from '../src/agent/types';

// ═══════════════════════════════════════════
// 1. color-map
// ═══════════════════════════════════════════

describe('agentColorIndex', () => {
  test('is deterministic', () => {
    expect(agentColorIndex('margaret')).toBe(agentColorIndex('margaret'));
    expect(agentColorIndex('jihoon')).toBe(agentColorIndex('jihoon'));
  });

  test('distinct names usually get distinct indices', () => {
    const names = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'];
    const indices = names.map(agentColorIndex);
    const unique = new Set(indices).size;
    // Not guaranteed unique (palette is 12 slots, 6 names) but should
    // at least produce more than one value.
    expect(unique).toBeGreaterThan(1);
  });

  test('empty string → index 0 (safe default)', () => {
    expect(agentColorIndex('')).toBe(0);
  });

  test('index always lands inside the palette range', () => {
    for (const name of ['a', 'very-long-persona-name-XYZ', '한글-페르소나', '12345']) {
      const idx = agentColorIndex(name);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(AGENT_PALETTE_HEX.length);
    }
  });
});

describe('agentColor', () => {
  test('returns a callable that preserves the input string', () => {
    const wrap = agentColor('margaret');
    // chalk may or may not emit ANSI bytes depending on TTY detection
    // in the test runner; what we CAN assert is that the wrap function
    // echoes the payload and that same-palette-index names share it.
    expect(wrap('hi')).toContain('hi');
    expect(typeof wrap).toBe('function');
  });

  test('names mapping to the same palette index share the color function', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm'];
    // Find a collision (palette is 12 slots, 13 names guarantees one).
    const byIdx = new Map<number, string[]>();
    for (const n of names) {
      const k = agentColorIndex(n);
      if (!byIdx.has(k)) byIdx.set(k, []);
      byIdx.get(k)!.push(n);
    }
    const colliding = [...byIdx.values()].find(arr => arr.length > 1);
    if (colliding) {
      expect(agentColor(colliding[0]!)).toBe(agentColor(colliding[1]!));
    }
  });
});

// ═══════════════════════════════════════════
// 2. AgentLogAdapter — per-agent streams
// ═══════════════════════════════════════════

describe('AgentLogAdapter — single agent stream', () => {
  const nopColor = () => agentColorNoop;

  test('text deltas are buffered until a newline arrives', () => {
    const la = new AgentLogAdapter({ color: nopColor });
    expect(la.ingest('a', { type: 'text', delta: 'Hel' })).toEqual([]);
    expect(la.ingest('a', { type: 'text', delta: 'lo' })).toEqual([]);
    const out = la.ingest('a', { type: 'text', delta: ' world\n' });
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe('[a] Hello world');
    expect(out[0]!.meta.kind).toBe('text');
  });

  test('text delta with embedded newlines emits multiple lines', () => {
    const la = new AgentLogAdapter({ color: nopColor });
    const out = la.ingest('a', { type: 'text', delta: 'line1\nline2\nlin' });
    expect(out).toHaveLength(2);
    expect(out[0]!.text).toBe('[a] line1');
    expect(out[1]!.text).toBe('[a] line2');
    // `lin` remains buffered — gets flushed on next event or close()
    const closed = la.close('a');
    expect(closed).toHaveLength(1);
    expect(closed[0]!.text).toBe('[a] lin');
  });

  test('tool_call flushes any pending text buffer first', () => {
    const la = new AgentLogAdapter({ color: nopColor });
    la.ingest('a', { type: 'text', delta: 'checking' });   // buffered
    const out = la.ingest('a', {
      type: 'tool_call', id: 'c1', name: 'echo', args: { x: 'hi' },
    });
    expect(out).toHaveLength(2);
    expect(out[0]!.text).toBe('[a] checking');
    expect(out[0]!.meta.kind).toBe('text');
    expect(out[1]!.text).toContain('➜ echo({"x":"hi"})');
    expect(out[1]!.meta.kind).toBe('tool_call');
  });

  test('tool_result renders with ← prefix + name + compact JSON', () => {
    const la = new AgentLogAdapter({ color: nopColor });
    const out = la.ingest('a', {
      type: 'tool_result', id: 'c1', name: 'echo', result: { echoed: 'hi' },
    });
    expect(out[0]!.text).toBe('[a] ← echo → {"echoed":"hi"}');
  });

  test('status emits a dimmed `· stage` line; terminal stages mark threadEnd', () => {
    const la = new AgentLogAdapter({ color: nopColor, dim: s => `~${s}~` });
    const thinking = la.ingest('a', { type: 'status', stage: 'thinking' });
    expect(thinking[0]!.text).toBe('[a] ~· thinking~');
    expect(thinking[0]!.meta.threadEnd).toBe(false);

    const done = la.ingest('a', { type: 'status', stage: 'done' });
    expect(done[0]!.meta.threadEnd).toBe(true);
  });

  test('error event renders with explicit message and marks threadEnd', () => {
    const la = new AgentLogAdapter({ color: nopColor });
    const out = la.ingest('a', { type: 'error', message: 'upstream 500' });
    expect(out[0]!.text).toContain('· error: upstream 500');
    expect(out[0]!.meta.threadEnd).toBe(true);
  });

  test('long tool call args get truncated with an ellipsis', () => {
    const la = new AgentLogAdapter({ color: nopColor });
    const bigArgs = { blob: 'x'.repeat(500) };
    const out = la.ingest('a', { type: 'tool_call', id: 'c', name: 'big', args: bigArgs });
    expect(out[0]!.text).toContain('…');
    expect(out[0]!.text.length).toBeLessThan(200);
  });
});

// ═══════════════════════════════════════════
// 3. AgentLogAdapter — multiple interleaved agents
// ═══════════════════════════════════════════

describe('AgentLogAdapter — interleaved streams', () => {
  const nopColor = () => agentColorNoop;

  test('each agent has its own buffer — streams don\'t cross-contaminate', () => {
    const la = new AgentLogAdapter({ color: nopColor });
    la.ingest('a', { type: 'text', delta: 'Alpha ' });
    la.ingest('b', { type: 'text', delta: 'Bravo ' });
    la.ingest('a', { type: 'text', delta: 'part2\n' });
    const out = la.ingest('b', { type: 'text', delta: 'part2\n' });
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe('[b] Bravo part2');
  });

  test('threadStart flips when a different agent emits after another', () => {
    const la = new AgentLogAdapter({ color: nopColor });
    const l1 = la.ingest('a', { type: 'text', delta: 'first\n' });
    const l2 = la.ingest('b', { type: 'text', delta: 'second\n' });
    const l3 = la.ingest('b', { type: 'text', delta: 'third\n' });
    expect(l1[0]!.meta.threadStart).toBe(true);    // first emission ever
    expect(l2[0]!.meta.threadStart).toBe(true);    // switched agent
    expect(l3[0]!.meta.threadStart).toBe(false);   // same agent as previous
  });

  test('linePrefix prepended to every emitted line', () => {
    const la = new AgentLogAdapter({ color: nopColor, linePrefix: '>> ' });
    const out = la.ingest('a', { type: 'text', delta: 'hi\n' });
    expect(out[0]!.text).toBe('>> [a] hi');
  });

  test('default palette is used when color opt is omitted', () => {
    const la = new AgentLogAdapter();   // uses real agentColor
    const out = la.ingest('margaret', { type: 'text', delta: 'hi\n' });
    // chalk's TTY detection may strip colors in the test runner, so we
    // can't assert ANSI bytes — just assert the content is intact and
    // the color function was exercised without throwing.
    expect(out[0]!.text).toContain('[margaret]');
    expect(out[0]!.text).toContain('hi');
  });
});

// ═══════════════════════════════════════════
// 4. reset / close semantics
// ═══════════════════════════════════════════

describe('AgentLogAdapter lifecycle', () => {
  const nopColor = () => agentColorNoop;

  test('close flushes only that agent\'s buffer', () => {
    const la = new AgentLogAdapter({ color: nopColor });
    la.ingest('a', { type: 'text', delta: 'partial-a' });
    la.ingest('b', { type: 'text', delta: 'partial-b' });
    const flushedA = la.close('a');
    expect(flushedA).toHaveLength(1);
    expect(flushedA[0]!.text).toBe('[a] partial-a');
    // b's buffer still present
    const flushedB = la.close('b');
    expect(flushedB[0]!.text).toBe('[b] partial-b');
  });

  test('reset clears all state', () => {
    const la = new AgentLogAdapter({ color: nopColor });
    la.ingest('a', { type: 'text', delta: 'buffered' });
    la.reset();
    expect(la.close('a')).toEqual([]);
  });
});

// ═══════════════════════════════════════════
// 5. HUD helpers
// ═══════════════════════════════════════════

describe('agentCounts / hudSummary', () => {
  test('counts tasks by state', () => {
    const c = agentCounts([
      { state: 'running' }, { state: 'running' }, { state: 'done' },
      { state: 'error' }, { state: 'aborted' }, { state: 'pending' },
    ]);
    expect(c).toEqual({ running: 2, done: 1, error: 1, aborted: 1, pending: 1 });
  });

  test('hudSummary: empty registry → empty string', () => {
    expect(hudSummary(agentCounts([]))).toBe('');
  });

  test('hudSummary: live tasks → in-flight indicator', () => {
    const s = hudSummary(agentCounts([
      { state: 'running' }, { state: 'running' }, { state: 'done' },
    ]));
    expect(s).toContain('in flight');
    expect(s).toContain('1/3');
  });

  test('hudSummary: all-done → success marker', () => {
    const s = hudSummary(agentCounts([
      { state: 'done' }, { state: 'done' }, { state: 'done' },
    ]));
    expect(s).toBe('✓ all 3 agents done');
  });

  test('hudSummary: mixed terminal states → itemised breakdown', () => {
    const s = hudSummary(agentCounts([
      { state: 'done' }, { state: 'done' },
      { state: 'error' }, { state: 'aborted' },
    ]));
    expect(s).toContain('2 ok');
    expect(s).toContain('1 err');
    expect(s).toContain('1 abort');
  });
});
