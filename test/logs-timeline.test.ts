// renderTimeline — pure narrative renderer over logs.db rows.
//
// Covers the readable-transcript conversion (내부 문서
// §3 task#10): goal iterations, tool calls + results, reasoning, and the
// runaway-discipline signals must all render as readable lines; render noise
// and unknown low-level events must be dropped.

import { describe, test, expect } from 'bun:test';
import { renderTimeline, TIMELINE_CATEGORIES } from '../src/cli/logs-timeline.js';
import type { LogStoreRow } from '../src/mss/logging/log-store.js';

let id = 0;
function row(category: string, event: string, data: unknown, level = 'info'): LogStoreRow {
  id += 1;
  return {
    id, ts: `2026-07-19T08:0${id % 10}:00.000Z`, ts_ms: id,
    level, instance: 'test', surface: 'nexus', category, event,
    session_id: null, trace_id: null,
    data: data === null ? null : JSON.stringify(data),
  };
}

describe('renderTimeline', () => {
  test('goal start renders header + objective first line', () => {
    const out = renderTimeline([
      row('goal.loop', 'start', { objective: 'Context:\nDashboard mode: browse\n\nQuestion: 코어를 살려서 써줘' }),
    ]);
    expect(out).toContain('GOAL START');
    expect(out).toContain('코어를 살려서 써줘');
    expect(out).not.toContain('Dashboard mode'); // Context/Dashboard lines skipped
  });

  test('goal iteration + complete render iteration facts', () => {
    const out = renderTimeline([
      row('goal.loop', 'iteration', { iteration: 2, stopReason: 'end_turn', lastInputTokens: 130433, finalChars: 1491 }),
      row('goal.loop', 'complete', { iterations: 4, via: 'update_goal' }),
    ]);
    expect(out).toContain('iter 2');
    expect(out).toContain('end_turn');
    expect(out).toContain('GOAL COMPLETE (4 iters');
  });

  test('tool call + result render tool name, compact args, and ok/error mark', () => {
    const out = renderTimeline([
      row('chat.tool-call', 'Grep', { id: 'c1', args: JSON.stringify({ pattern: 'analyzeGoalAmbiguity', path: 'src' }) }),
      row('chat.tool-result', 'Grep', { id: 'c1', preview: '{"output":"213:export async function analyzeGoalAmbiguity("}' }),
      row('chat.tool-call', 'Edit', { id: 'c2', args: JSON.stringify({ file_path: 'src/hitl/clarification-policy.ts' }) }),
      row('chat.tool-result', 'Edit', { id: 'c2', preview: '{"error":"Edit: old_string not found"}' }),
    ]);
    expect(out).toContain('🔧');
    expect(out).toContain('Grep(analyzeGoalAmbiguity @ src)');
    expect(out).toContain('✓');
    expect(out).toContain('✗ ERROR');
    expect(out).toContain('old_string not found');
  });

  test('reasoning delta renders preview; part_added is dropped', () => {
    const out = renderTimeline([
      row('llm.reasoning', 'codex.summary.part_added', { summaryIndex: 0 }),
      row('llm.reasoning', 'codex.summary.delta', { preview: '**Planning research pipeline strategy**' }),
    ]);
    expect(out).toContain('Planning research pipeline strategy');
    expect(out.match(/💭/g)?.length).toBe(1);
  });

  test('runaway-discipline signals render (repeat / compact / idle)', () => {
    const out = renderTimeline([
      row('llm.tool-loop.repeat', 'identical-success-detected', { tool: 'Read', window: 5 }),
      row('llm.router', 'tool-loop.midloop-compact', { beforeLen: 67, afterLen: 20, escalated: true }),
      row('llm.stream', 'idle-timeout', { idleMs: 180000, turn: 12, evCount: 3 }),
    ]);
    expect(out).toContain('REPEAT — Read ×5');
    expect(out).toContain('COMPACT 67→20 (LLM-escalated)');
    expect(out).toContain('idle-timeout 180000ms');
  });

  test('unknown info-level events are dropped; error-level events surface', () => {
    const out = renderTimeline([
      row('llm.router', 'getProviderForConfig', { configProvider: 'openai-codex' }, 'info'),
      row('some.category', 'boom', { detail: 'kaboom' }, 'error'),
    ]);
    expect(out).not.toContain('getProviderForConfig');
    expect(out).toContain('boom');
    expect(out).toContain('kaboom');
  });

  test('empty input → empty string', () => {
    expect(renderTimeline([])).toBe('');
  });

  test('TIMELINE_CATEGORIES covers the signal categories', () => {
    expect(TIMELINE_CATEGORIES).toContain('goal.loop');
    expect(TIMELINE_CATEGORIES).toContain('chat.tool-call');
    expect(TIMELINE_CATEGORIES).toContain('llm.tool-loop');
  });
});
