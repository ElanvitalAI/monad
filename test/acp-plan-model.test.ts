// Unit tests for ACP plan model — H1 #2.
//
// Pure data-shape + render tests. No ACP subprocess involved.

import { describe, expect, test } from 'bun:test';
import { createPlanModel } from '../src/acp/plan-model.js';
import type { Plan as WirePlan } from '@agentclientprotocol/sdk';

function wire(entries: Array<{ content: string; priority?: 'high' | 'medium' | 'low'; status?: 'pending' | 'in_progress' | 'completed' }>): WirePlan {
  return {
    entries: entries.map((e) => ({
      content: e.content,
      priority: e.priority ?? 'medium',
      status: e.status ?? 'pending',
    })),
  };
}

describe('createPlanModel · applyWire', () => {
  test('sets stats correctly for mixed-status plan', () => {
    const m = createPlanModel();
    const snap = m.applyWire(wire([
      { content: 'design', status: 'completed' },
      { content: 'implement', status: 'in_progress' },
      { content: 'test', status: 'pending' },
      { content: 'ship', status: 'pending' },
    ]));
    expect(snap.stats.total).toBe(4);
    expect(snap.stats.completed).toBe(1);
    expect(snap.stats.inProgress).toBe(1);
    expect(snap.stats.pending).toBe(2);
    expect(snap.stats.currentEntry?.content).toBe('implement');
  });

  test('replace semantics — second apply with fewer entries shrinks the list', () => {
    const m = createPlanModel();
    m.applyWire(wire([
      { content: 'a' }, { content: 'b' }, { content: 'c' },
    ]));
    const snap = m.applyWire(wire([
      { content: 'x' },
    ]));
    expect(snap.entries).toHaveLength(1);
    expect(snap.entries[0]?.content).toBe('x');
  });

  test('replace semantics — second apply with more entries grows the list', () => {
    const m = createPlanModel();
    m.applyWire(wire([{ content: 'a' }]));
    const snap = m.applyWire(wire([
      { content: 'a' }, { content: 'b' }, { content: 'c' },
    ]));
    expect(snap.entries).toHaveLength(3);
    expect(snap.entries[2]?.content).toBe('c');
  });

  test('replace semantics — order change propagates', () => {
    const m = createPlanModel();
    m.applyWire(wire([{ content: 'first' }, { content: 'second' }]));
    const snap = m.applyWire(wire([{ content: 'second' }, { content: 'first' }]));
    expect(snap.entries.map((e) => e.content)).toEqual(['second', 'first']);
  });

  test('version bumps on each applyWire', () => {
    const m = createPlanModel();
    const v1 = m.applyWire(wire([{ content: 'a' }])).version;
    const v2 = m.applyWire(wire([{ content: 'b' }])).version;
    const v3 = m.applyWire(wire([{ content: 'c' }])).version;
    expect(v2).toBe(v1 + 1);
    expect(v3).toBe(v2 + 1);
  });

  test('version bumps on clear', () => {
    const m = createPlanModel();
    const v1 = m.applyWire(wire([{ content: 'a' }])).version;
    const v2 = m.clear().version;
    expect(v2).toBe(v1 + 1);
  });

  test('currentEntry is null when all completed', () => {
    const m = createPlanModel();
    const snap = m.applyWire(wire([
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'completed' },
    ]));
    expect(snap.stats.currentEntry).toBeNull();
  });

  test('currentEntry is first in_progress (not last)', () => {
    const m = createPlanModel();
    const snap = m.applyWire(wire([
      { content: 'a', status: 'in_progress' },
      { content: 'b', status: 'in_progress' },
    ]));
    expect(snap.stats.currentEntry?.content).toBe('a');
  });

  test('clear empties entries', () => {
    const m = createPlanModel();
    m.applyWire(wire([{ content: 'a' }, { content: 'b' }]));
    const snap = m.clear();
    expect(snap.entries).toEqual([]);
    expect(snap.stats.total).toBe(0);
    expect(snap.stats.currentEntry).toBeNull();
  });

  test('snapshot returns cloned entries (caller cannot mutate internal state)', () => {
    const m = createPlanModel();
    const snap = m.applyWire(wire([{ content: 'a' }]));
    // Mutate the returned entry.
    const first = snap.entries[0];
    if (first) first.content = 'mutated';
    const snap2 = m.snapshot();
    expect(snap2.entries[0]?.content).toBe('a');
  });
});

describe('createPlanModel · render', () => {
  test('renderSummary for empty plan', () => {
    const m = createPlanModel();
    expect(m.renderSummary()).toBe('◦ plan empty');
  });

  test('renderSummary for in-progress plan shows step N/M · title', () => {
    const m = createPlanModel();
    m.applyWire(wire([
      { content: 'design', status: 'completed' },
      { content: 'implement', status: 'in_progress' },
      { content: 'test', status: 'pending' },
    ]));
    const s = m.renderSummary();
    expect(s).toContain('2/3');
    expect(s).toContain('implement');
    expect(s).toContain('pending');
    expect(s).toContain('done');
  });

  test('renderSummary for plan with no in_progress still shows step', () => {
    const m = createPlanModel();
    m.applyWire(wire([
      { content: 'design', status: 'completed' },
      { content: 'implement', status: 'pending' },
    ]));
    const s = m.renderSummary();
    // completed=1, so next step index = 2.
    expect(s).toContain('2/2');
  });

  test('renderSummary for all completed plan', () => {
    const m = createPlanModel();
    m.applyWire(wire([
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'completed' },
    ]));
    expect(m.renderSummary()).toBe('✓ plan complete (2/2)');
  });

  test('renderFull has one line per entry with correct glyph', () => {
    const m = createPlanModel();
    m.applyWire(wire([
      { content: 'design', status: 'completed' },
      { content: 'implement', status: 'in_progress' },
      { content: 'test', status: 'pending' },
    ]));
    const lines = m.renderFull();
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('[✓] step 1 — design');
    expect(lines[1]).toBe('[▶] step 2 — implement');
    expect(lines[2]).toBe('[ ] step 3 — test');
  });

  test('renderFull for empty plan', () => {
    const m = createPlanModel();
    expect(m.renderFull()).toEqual(['◦ plan empty']);
  });
});
