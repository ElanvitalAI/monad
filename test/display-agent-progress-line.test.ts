import { describe, expect, test } from 'bun:test';
import {
  renderAgentProgressBlock,
  type AgentProgressEntry,
} from '../src/display/agent-progress-line.js';

function entry(over: Partial<AgentProgressEntry> & Pick<AgentProgressEntry, 'id' | 'name' | 'status'>): AgentProgressEntry {
  return { toolCount: 0, ...over };
}

describe('renderAgentProgressBlock', () => {
  test('empty input → empty output (caller skips replaceBlock)', () => {
    expect(renderAgentProgressBlock([])).toEqual([]);
  });

  test('single running agent — header + 1 line, last branch', () => {
    const out = renderAgentProgressBlock([
      entry({ id: 'a', name: 'explore', status: 'running', toolCount: 3 }),
    ]);
    expect(out.length).toBe(2);
    expect(out[0]).toContain('Agents');
    expect(out[0]).toContain('1 running');
    expect(out[1]).toContain('└─');
    expect(out[1]).toContain('explore');
    expect(out[1]).toContain('3 tools');
  });

  test('multi-agent fleet — middle uses ├─, last uses └─', () => {
    const out = renderAgentProgressBlock([
      entry({ id: 'a', name: 'explore', status: 'running', toolCount: 4 }),
      entry({ id: 'b', name: 'plan', status: 'running', toolCount: 7 }),
      entry({ id: 'c', name: 'verify', status: 'queued', toolCount: 0 }),
    ]);
    expect(out[0]).toContain('Agents');
    expect(out[1]).toContain('├─');
    expect(out[1]).toContain('explore');
    expect(out[2]).toContain('├─');
    expect(out[2]).toContain('plan');
    expect(out[3]).toContain('└─');
    expect(out[3]).toContain('verify');
  });

  test('lastToolText renders as indented sub-line under the agent', () => {
    const out = renderAgentProgressBlock([
      entry({
        id: 'a',
        name: 'explore',
        status: 'running',
        toolCount: 4,
        lastToolText: 'Read src/foo.ts',
      }),
      entry({ id: 'b', name: 'plan', status: 'running', toolCount: 1 }),
    ]);
    // Header + agent-a header line + indented lastTool + agent-b header line.
    expect(out.length).toBe(4);
    expect(out[1]).toContain('explore');
    expect(out[2]).toContain('Read src/foo.ts');
    // Continuation indent for non-last agent uses │ prefix.
    expect(out[2]!.startsWith('│  ') || out[2]!.includes('│')).toBe(true);
    expect(out[3]).toContain('plan');
  });

  test('overflow beyond maxDisplay collapses to +N more line', () => {
    const entries: AgentProgressEntry[] = Array.from({ length: 6 }, (_, i) =>
      entry({ id: `id-${i}`, name: `agent-${i}`, status: 'running', toolCount: i }),
    );
    const out = renderAgentProgressBlock(entries, { maxDisplay: 3 });
    // Header + 3 visible + overflow line = 5.
    expect(out.length).toBe(5);
    expect(out[0]).toContain('Agents');
    expect(out[4]).toContain('+3 more');
    // When overflow exists, the 3 visible all use ├─ (none get └─).
    expect(out[1]).toContain('├─');
    expect(out[2]).toContain('├─');
    expect(out[3]).toContain('├─');
    expect(out[4]).toContain('└─');
  });

  test('maxDisplay = 1 still shows overflow line', () => {
    const out = renderAgentProgressBlock(
      [
        entry({ id: 'a', name: 'a', status: 'running', toolCount: 1 }),
        entry({ id: 'b', name: 'b', status: 'running', toolCount: 1 }),
      ],
      { maxDisplay: 1 },
    );
    expect(out.length).toBe(3);
    expect(out[2]).toContain('+1 more');
  });

  test('summary shows running / done / error counts when mixed', () => {
    const out = renderAgentProgressBlock([
      entry({ id: 'a', name: 'a', status: 'running', toolCount: 2 }),
      entry({ id: 'b', name: 'b', status: 'done', toolCount: 5 }),
      entry({ id: 'c', name: 'c', status: 'error', toolCount: 1 }),
    ]);
    expect(out[0]).toContain('1 running');
    expect(out[0]).toContain('1 done');
    expect(out[0]).toContain('1 error');
  });

  test('singular vs plural — "1 tool" not "1 tools"', () => {
    const out = renderAgentProgressBlock([
      entry({ id: 'a', name: 'a', status: 'running', toolCount: 1 }),
      entry({ id: 'b', name: 'b', status: 'running', toolCount: 0 }),
    ]);
    expect(out[1]).toContain('1 tool');
    expect(out[1]).not.toContain('1 tools');
    expect(out[2]).toContain('0 tools');
  });

  test('elapsedMs formatting — ms / s / m', () => {
    const out = renderAgentProgressBlock(
      [
        entry({ id: 'a', name: 'a', status: 'running', toolCount: 1, elapsedMs: 850 }),
        entry({ id: 'b', name: 'b', status: 'running', toolCount: 1, elapsedMs: 5000 }),
        entry({ id: 'c', name: 'c', status: 'running', toolCount: 1, elapsedMs: 65000 }),
        entry({ id: 'd', name: 'd', status: 'done', toolCount: 1, elapsedMs: 120000 }),
      ],
      { maxDisplay: 4 },
    );
    expect(out[1]).toContain('850ms');
    expect(out[2]).toContain('5s');
    expect(out[3]).toContain('1m 5s');
    expect(out[4]).toContain('2m');
  });

  test('elapsedMs = 0 or undefined → no elapsed segment', () => {
    const out = renderAgentProgressBlock([
      entry({ id: 'a', name: 'a', status: 'running', toolCount: 2 }),
      entry({ id: 'b', name: 'b', status: 'running', toolCount: 1, elapsedMs: 0 }),
    ]);
    // Neither line should mention 's' as elapsed — simplest check: no
    // trailing pattern like '· 0s' or similar.
    expect(out[1]).not.toMatch(/· \d+m?s/);
    expect(out[2]).not.toMatch(/· \d+m?s/);
  });

  test('color hooks are invoked when supplied (only running glyph)', () => {
    const calls: string[] = [];
    const tag = (label: string) => (s: string): string => {
      calls.push(`${label}:${s}`);
      return `[${label}]${s}`;
    };
    const out = renderAgentProgressBlock(
      [entry({ id: 'a', name: 'agent', status: 'running', toolCount: 2 })],
      {
        colors: {
          muted: tag('mu'),
          running: tag('ru'),
          done: tag('do'),
          error: tag('er'),
        },
      },
    );
    // Header is muted; the status glyph for running is colored.
    expect(out[0]).toContain('[mu]');
    expect(out[1]).toContain('[ru]');
    // No done / error tags surfaced.
    expect(calls.some((c) => c.startsWith('do:'))).toBe(false);
    expect(calls.some((c) => c.startsWith('er:'))).toBe(false);
  });
});
