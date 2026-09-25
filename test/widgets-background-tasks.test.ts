import { describe, expect, test } from 'bun:test';
import widget, {
  renderBackgroundTaskRow,
  type BackgroundTaskRow,
  type BackgroundTasksWidgetState,
} from '../src/widgets/background-tasks.js';

function row(over: Partial<BackgroundTaskRow> & Pick<BackgroundTaskRow, 'id' | 'source' | 'label' | 'status'>): BackgroundTaskRow {
  return { ...over };
}

function ctx(width = 80, height = 20): { width: number; height: number; focused: boolean } {
  return { width, height, focused: false };
}

describe('renderBackgroundTaskRow', () => {
  test('agent row shows ◆ glyph + label', () => {
    const out = renderBackgroundTaskRow(
      row({ id: 'a', source: 'agent', label: 'explore', status: 'running' }),
      80,
    );
    expect(out).toContain('◆');
    expect(out).toContain('●');
    expect(out).toContain('explore');
  });

  test('shell row uses ▫ glyph', () => {
    const out = renderBackgroundTaskRow(
      row({ id: 's', source: 'shell', label: 'rg pattern', status: 'running' }),
      80,
    );
    expect(out).toContain('▫');
    expect(out).toContain('rg pattern');
  });

  test('workflow row uses ⚙ glyph + detail', () => {
    const out = renderBackgroundTaskRow(
      row({ id: 'w', source: 'workflow', label: 'wf-a', status: 'running', detail: 'step 2/5' }),
      80,
    );
    expect(out).toContain('⚙');
    expect(out).toContain('step 2/5');
  });

  // Surface-unification v2.2 V2.2-5 (2026-05-11) — `'scheduler'` source
  // kind retired (scheduler view 폐기 · workflow runs 가 동일 데이터
  // 흡수). The `⏱` glyph mapping is gone with the union member.

  test('error status uses ✗ glyph', () => {
    const out = renderBackgroundTaskRow(
      row({ id: 'e', source: 'shell', label: 'bad cmd', status: 'error' }),
      80,
    );
    expect(out).toContain('✗');
  });

  test('elapsedMs renders as ms / s / m', () => {
    expect(renderBackgroundTaskRow(
      row({ id: '1', source: 'agent', label: 'a', status: 'running', elapsedMs: 500 }),
      80,
    )).toContain('500ms');
    expect(renderBackgroundTaskRow(
      row({ id: '2', source: 'agent', label: 'b', status: 'running', elapsedMs: 5000 }),
      80,
    )).toContain('5s');
    expect(renderBackgroundTaskRow(
      row({ id: '3', source: 'agent', label: 'c', status: 'running', elapsedMs: 65000 }),
      80,
    )).toContain('1m 5s');
  });

  test('elapsed=0 / undefined → no elapsed segment', () => {
    expect(renderBackgroundTaskRow(
      row({ id: '1', source: 'agent', label: 'a', status: 'running' }),
      80,
    )).not.toMatch(/\d+(ms|s|m)/);
    expect(renderBackgroundTaskRow(
      row({ id: '2', source: 'agent', label: 'b', status: 'running', elapsedMs: 0 }),
      80,
    )).not.toMatch(/\d+(ms|s|m)/);
  });

  test('long label is truncated within width budget', () => {
    const longLabel = 'x'.repeat(100);
    const out = renderBackgroundTaskRow(
      row({ id: '1', source: 'agent', label: longLabel, status: 'running' }),
      30,
    );
    expect(out.length).toBeLessThanOrEqual(30);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('background-tasks widget', () => {
  test('initialState — empty default + provided rows', () => {
    const empty = widget.initialState!();
    expect(empty.rows).toEqual([]);
    expect(empty.cursor).toBe(0);
    const seeded = widget.initialState!({
      rows: [row({ id: '1', source: 'agent', label: 'a', status: 'running' })],
    });
    expect(seeded.rows.length).toBe(1);
  });

  test('render with empty rows shows placeholder', () => {
    const lines = widget.render({ rows: [], cursor: 0 }, ctx() as never, 'Background');
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('No active background tasks');
  });

  test('render shows cursor prefix on focused row (with grouping)', () => {
    const state: BackgroundTasksWidgetState = {
      rows: [
        row({ id: 'a', source: 'agent', label: 'one', status: 'running' }),
        row({ id: 'b', source: 'shell', label: 'two', status: 'running' }),
      ],
      cursor: 1,
    };
    const lines = widget.render(state, ctx() as never, 'Background');
    // Layout (Wave P4c grouping):
    //   lines[0] = AGENT (1) header
    //   lines[1] = '  ' agent row 'one' (cursor=1 → not focused)
    //   lines[2] = SHELL (1) header
    //   lines[3] = '> ' shell row 'two' (cursor=1 → focused)
    const focusedLines = lines.filter((l) => l.startsWith('> '));
    expect(focusedLines.length).toBe(1);
    expect(focusedLines[0]).toContain('two');
    const unfocusedRowLines = lines.filter((l) => l.startsWith('  ') && !l.includes('AGENT') && !l.includes('SHELL'));
    expect(unfocusedRowLines.some((l) => l.includes('one'))).toBe(true);
  });

  test('render respects ctx.height ceiling', () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      row({ id: String(i), source: 'agent', label: `r${i}`, status: 'running' }));
    const lines = widget.render({ rows, cursor: 0 }, ctx(80, 5) as never, 'Background');
    expect(lines.length).toBeLessThanOrEqual(5);
  });

  test('onKey j/k moves cursor within bounds', () => {
    const state: BackgroundTasksWidgetState = {
      rows: [
        row({ id: 'a', source: 'agent', label: 'one', status: 'running' }),
        row({ id: 'b', source: 'shell', label: 'two', status: 'running' }),
        row({ id: 'c', source: 'workflow', label: 'three', status: 'running' }),
      ],
      cursor: 0,
    };
    widget.onKey!({ name: 'j' } as never, state, {} as never);
    expect(state.cursor).toBe(1);
    widget.onKey!({ name: 'j' } as never, state, {} as never);
    expect(state.cursor).toBe(2);
    widget.onKey!({ name: 'j' } as never, state, {} as never);
    expect(state.cursor).toBe(2);
    widget.onKey!({ name: 'k' } as never, state, {} as never);
    expect(state.cursor).toBe(1);
  });

  test('onKey g/G jumps to first/last', () => {
    const state: BackgroundTasksWidgetState = {
      rows: [
        row({ id: 'a', source: 'agent', label: 'one', status: 'running' }),
        row({ id: 'b', source: 'shell', label: 'two', status: 'running' }),
      ],
      cursor: 0,
    };
    widget.onKey!({ name: 'G' } as never, state, {} as never);
    expect(state.cursor).toBe(1);
    widget.onKey!({ name: 'g' } as never, state, {} as never);
    expect(state.cursor).toBe(0);
  });

  test('onKey is no-op when rows empty', () => {
    const state: BackgroundTasksWidgetState = { rows: [], cursor: 0 };
    const r = widget.onKey!({ name: 'j' } as never, state, {} as never);
    expect(r).toEqual({ type: 'none' });
  });

  test('onKey unknown key returns none', () => {
    const state: BackgroundTasksWidgetState = {
      rows: [row({ id: 'a', source: 'agent', label: 'one', status: 'running' })],
      cursor: 0,
    };
    const r = widget.onKey!({ name: 'x' } as never, state, {} as never);
    expect(r).toEqual({ type: 'none' });
  });

  test('Wave P4a-3 — onKey "d" fires onAction(abort) for abortable row', () => {
    const calls: { id: string; action: string; source: string }[] = [];
    const state: BackgroundTasksWidgetState = {
      rows: [
        row({ id: 'agent:a', source: 'agent', label: 'one', status: 'running', abortable: true }),
      ],
      cursor: 0,
      onAction: (id, action, source) => calls.push({ id, action, source }),
    };
    const r = widget.onKey!({ name: 'd' } as never, state, {} as never);
    expect(r).toEqual({ type: 'refresh' });
    expect(calls).toEqual([{ id: 'agent:a', action: 'abort', source: 'agent' }]);
    expect(state.pendingActionRowId).toBe('agent:a');
  });

  test('onKey "d" is ignored when row is not abortable', () => {
    const calls: number[] = [];
    const state: BackgroundTasksWidgetState = {
      rows: [
        row({ id: 'wf:w', source: 'workflow', label: 'wf-a', status: 'running', abortable: false }),
      ],
      cursor: 0,
      onAction: () => calls.push(1),
    };
    const r = widget.onKey!({ name: 'd' } as never, state, {} as never);
    expect(r).toEqual({ type: 'none' });
    expect(calls).toEqual([]);
  });

  // Surface-unification v2.2 V2.2-5 (2026-05-11) — onKey 'p' (pause)
  // 액션 retire. pause 는 scheduler-only 액션이었고 그 source kind 도
  // retire 됨. agent/shell/workflow 는 'd' (abort) 만 지원.

  test('initialState forwards onAction from config to state', () => {
    const fn = (): void => {};
    const s = widget.initialState!({
      rows: [row({ id: 'a', source: 'agent', label: 'a', status: 'running' })],
      onAction: fn,
    });
    expect(s.onAction).toBe(fn);
  });

  test('Wave P4c — render groups rows by source with category headers', () => {
    const state: BackgroundTasksWidgetState = {
      rows: [
        row({ id: 'agent:a', source: 'agent', label: 'explore', status: 'running' }),
        row({ id: 'agent:b', source: 'agent', label: 'plan', status: 'running' }),
        row({ id: 'shell:s', source: 'shell', label: 'rg foo', status: 'running' }),
        row({ id: 'wf:w', source: 'workflow', label: 'wf-a', status: 'running' }),
      ],
      cursor: 0,
    };
    const lines = widget.render(state, ctx() as never, 'Background');
    // Headers contain source name + count.
    const headers = lines.filter((l) => l.includes('AGENT') || l.includes('SHELL') || l.includes('WORKFLOW') || l.includes('SCHEDULER'));
    expect(headers.some((l) => l.includes('AGENT (2)'))).toBe(true);
    expect(headers.some((l) => l.includes('SHELL (1)'))).toBe(true);
    expect(headers.some((l) => l.includes('WORKFLOW (1)'))).toBe(true);
  });

  test('header order — agent → shell → workflow', () => {
    // Surface-unification v2.2 V2.2-5 (2026-05-11) — `'scheduler'` source
    // kind retired. Header order now bottoms out at WORKFLOW.
    const state: BackgroundTasksWidgetState = {
      rows: [
        row({ id: 'wf:w', source: 'workflow', label: 'wf-a', status: 'running' }),
        row({ id: 'shell:s', source: 'shell', label: 'rg', status: 'running' }),
        row({ id: 'agent:a', source: 'agent', label: 'explore', status: 'running' }),
      ],
      cursor: 0,
    };
    const lines = widget.render(state, ctx() as never, 'Background');
    const text = lines.join('\n');
    const agentIdx = text.indexOf('AGENT');
    const shellIdx = text.indexOf('SHELL');
    const wfIdx = text.indexOf('WORKFLOW');
    expect(agentIdx).toBeGreaterThanOrEqual(0);
    expect(shellIdx).toBeGreaterThan(agentIdx);
    expect(wfIdx).toBeGreaterThan(shellIdx);
    expect(text).not.toContain('SCHEDULER');
  });

  test('cursor index tracks visible row in source-priority order', () => {
    const state: BackgroundTasksWidgetState = {
      rows: [
        row({ id: 'shell:1', source: 'shell', label: 's', status: 'running' }),
        row({ id: 'agent:1', source: 'agent', label: 'a1', status: 'running' }),
        row({ id: 'agent:2', source: 'agent', label: 'a2', status: 'running' }),
      ],
      // After grouping the rows render in agent[a1, a2], shell[s] order.
      // cursor=0 highlights agent a1 by virtue of state.rows[0]
      // which is the first row whose render position is 0.
      cursor: 0,
    };
    const lines = widget.render(state, ctx() as never, 'Background');
    // The first row line under AGENT must carry the cursor prefix.
    const agentBlock = lines.findIndex((l) => l.includes('AGENT'));
    expect(agentBlock).toBeGreaterThanOrEqual(0);
    // The very next line is the cursor row.
    const firstUnderAgent = lines[agentBlock + 1] ?? '';
    expect(firstUnderAgent.startsWith('> ')).toBe(true);
  });

  test('source bucket with zero rows is skipped (no header)', () => {
    const state: BackgroundTasksWidgetState = {
      rows: [row({ id: 'agent:1', source: 'agent', label: 'a', status: 'running' })],
      cursor: 0,
    };
    const lines = widget.render(state, ctx() as never, 'Background');
    expect(lines.some((l) => l.includes('SHELL'))).toBe(false);
    expect(lines.some((l) => l.includes('WORKFLOW'))).toBe(false);
    expect(lines.some((l) => l.includes('SCHEDULER'))).toBe(false);
  });
});
