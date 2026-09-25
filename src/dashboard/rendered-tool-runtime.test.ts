// Paired unit test of ./rendered-tool-runtime.ts. Colocated so a change-scoped
// gate that lists this source also sees kind-unit coalescing; the original
// landing omitted this file from its target paths, so the disabled guard
// shipped with two failing cases on the default branch.
import { describe, expect, spyOn, test } from 'bun:test';

import { debug } from '../debug/log.js';
import { FoldStack } from '../fold-stack.js';
import { foldKindHint } from '../log-entry.js';
import { createDashboardRenderedToolRuntime } from './rendered-tool-runtime.js';

function makeRuntime(chatLines: string[] = []) {
  const foldStack = new FoldStack({ chatLines });
  const runtime = createDashboardRenderedToolRuntime({
    chatLines,
    foldStack,
    pinChatTail: () => {},
    draw: () => {},
  });
  return { chatLines, foldStack, runtime };
}

describe('kind-unit adjacent coalescing', () => {
  test('three adjacent same-kind calls collapse to one line with count and kind', () => {
    const { chatLines, runtime } = makeRuntime();
    for (const [id, file] of [['c1', 'a.ts'], ['c2', 'b.ts'], ['c3', 'c.ts']] as const) {
      runtime.replaceBlock(id, [`Read ${file}`], chatLines.length);
      runtime.registerFold(id, [`Read ${file}`], [`Read ${file}`, 'body'], { operationKind: 'Read' });
    }
    expect(chatLines).toEqual([foldKindHint('Read', 3)]);
  });

  test('different kinds and non-adjacent same kinds stay separate', () => {
    const { chatLines, runtime } = makeRuntime();
    runtime.replaceBlock('r1', ['Read a.ts'], 0);
    runtime.registerFold('r1', ['Read a.ts'], ['Read a.ts', 'body'], { operationKind: 'Read' });
    runtime.replaceBlock('e1', ['Edit a.ts'], chatLines.length);
    runtime.registerFold('e1', ['Edit a.ts'], ['Edit a.ts', 'body'], { operationKind: 'Edit' });
    runtime.replaceBlock('r2', ['Read b.ts'], chatLines.length);
    runtime.registerFold('r2', ['Read b.ts'], ['Read b.ts', 'body'], { operationKind: 'Read' });
    expect(chatLines).toEqual(['Read a.ts', 'Edit a.ts', 'Read b.ts']);
  });

  test('unknown tools fall back to the tool name as the grouping kind', () => {
    const { chatLines, runtime } = makeRuntime();
    runtime.replaceBlock('p1', ['CustomProbe 1'], 0);
    runtime.registerFold('p1', ['CustomProbe 1'], ['CustomProbe 1', 'body'], { operationKind: 'CustomProbe' });
    runtime.replaceBlock('p2', ['CustomProbe 2'], chatLines.length);
    runtime.registerFold('p2', ['CustomProbe 2'], ['CustomProbe 2', 'body'], { operationKind: 'CustomProbe' });
    expect(chatLines).toEqual([foldKindHint('CustomProbe', 2)]);
  });

  test('line/task-unit registerFold without grouping keeps per-tool folds', () => {
    const { chatLines, runtime } = makeRuntime();
    runtime.replaceBlock('c1', ['Read a.ts'], 0);
    runtime.registerFold('c1', ['Read a.ts'], ['Read a.ts', 'body']);
    runtime.replaceBlock('c2', ['Read b.ts'], chatLines.length);
    runtime.registerFold('c2', ['Read b.ts'], ['Read b.ts', 'body']);
    expect(chatLines).toEqual(['Read a.ts', 'Read b.ts']);
  });
});

describe('kind-unit fold-applied observation', () => {
  test('emits fold-applied on group create and keeps the first-callId key as the group grows', () => {
    const applied: Array<{ mode?: unknown; count?: unknown; groupKey?: unknown }> = [];
    const log = spyOn(debug, 'log').mockImplementation(((category: string, event: string, data?: Record<string, unknown>) => {
      if (category === 'log.fold' && event === 'fold-applied') {
        applied.push({
          mode: data?.mode,
          count: data?.count,
          groupKey: data?.groupKey,
        });
      }
    }) as typeof debug.log);

    try {
      const { runtime } = makeRuntime();
      runtime.replaceBlock('c1', ['Read a.ts'], 0);
      runtime.registerFold('c1', ['Read a.ts'], ['Read a.ts', 'body'], { operationKind: 'Read' });
      runtime.replaceBlock('c2', ['Read b.ts'], 1);
      runtime.registerFold('c2', ['Read b.ts'], ['Read b.ts', 'body'], { operationKind: 'Read' });

      expect(applied.length).toBeGreaterThanOrEqual(2);
      expect(applied[0]?.count).toBe(1);
      expect(applied[applied.length - 1]?.count).toBe(2);
      const keys = applied.map((entry) => entry.groupKey);
      expect(new Set(keys).size).toBe(1);
      expect(keys[0]).toBe('c1');
      expect(keys[0]).not.toMatch(/^kind-/);
      expect(applied.every((entry) => entry.mode === 'kind-unit')).toBe(true);
    } finally {
      log.mockRestore();
    }
  });
});

type FoldLog = { event: string; data: Record<string, unknown> };

function collectFoldLogs(): { logs: FoldLog[]; restore: () => void } {
  const logs: FoldLog[] = [];
  const spy = spyOn(debug, 'log').mockImplementation(((category: string, event: string, data?: Record<string, unknown>) => {
    if (category === 'log.fold') logs.push({ event, data: { ...data } });
  }) as typeof debug.log);
  return { logs, restore: () => spy.mockRestore() };
}

describe('createDashboardRenderedToolRuntime registerFold fold-expanded groupKey', () => {
  test('toggleAtLine expand emits one fold-expanded whose groupKey matches fold-applied', () => {
    const { logs, restore } = collectFoldLogs();
    try {
      const { foldStack, runtime } = makeRuntime();
      runtime.replaceBlock('c1', ['Read a.ts'], 0);
      runtime.registerFold('c1', ['Read a.ts'], ['Read a.ts', 'body'], { operationKind: 'Read' });
      const applied = logs.filter((entry) => entry.event === 'fold-applied');
      expect(applied).toHaveLength(1);
      expect(applied[0]?.data.groupKey).toBe('c1');
      expect(applied[0]?.data.mode).toBe('kind-unit');

      logs.length = 0;
      expect(foldStack.toggleAtLine(0)).toBe(true);
      const expanded = logs.filter((entry) => entry.event === 'fold-expanded');
      expect(expanded).toHaveLength(1);
      expect(expanded[0]?.data.groupKey).toBe(applied[0]?.data.groupKey);
      expect(expanded[0]?.data.mode).toBe(applied[0]?.data.mode);
    } finally {
      restore();
    }
  });
});

describe('createDashboardRenderedToolRuntime registerFold fold-recollapsed exclusivity', () => {
  test('recollapsing via toggleAtLine emits fold-recollapsed and not fold-expanded', () => {
    const { foldStack, runtime } = makeRuntime();
    runtime.replaceBlock('c1', ['Read a.ts'], 0);
    runtime.registerFold('c1', ['Read a.ts'], ['Read a.ts', 'body'], { operationKind: 'Read' });
    expect(foldStack.toggleAtLine(0)).toBe(true);

    const { logs, restore } = collectFoldLogs();
    try {
      expect(foldStack.toggleAtLine(0)).toBe(true);
      const recollapsed = logs.filter((entry) => entry.event === 'fold-recollapsed');
      expect(recollapsed).toHaveLength(1);
      const record = recollapsed[0]!;
      expect(record.data.mode).toBe('kind-unit');
      expect(record.data.groupKey).toBe('c1');
      expect(record.data.lineIndex).toBe(0);
      expect(record.data.lineStart).toBe(0);
      expect(record.data.lineEnd).toBe(2);
      expect(logs.filter((entry) => entry.event === 'fold-expanded')).toEqual([]);
    } finally {
      restore();
    }
  });
});

describe('createDashboardRenderedToolRuntime registerFold fold-broken', () => {
  test('a !operationKind registerFold emits fold-broken for the preceding group', () => {
    const { logs, restore } = collectFoldLogs();
    try {
      const { runtime } = makeRuntime();
      runtime.replaceBlock('c1', ['Read a.ts'], 0);
      runtime.registerFold('c1', ['Read a.ts'], ['Read a.ts', 'body'], { operationKind: 'Read' });
      const appliedKey = logs.find((entry) => entry.event === 'fold-applied')?.data.groupKey;
      expect(appliedKey).toBe('c1');

      logs.length = 0;
      runtime.replaceBlock('c2', ['Read b.ts'], 1);
      runtime.registerFold('c2', ['Read b.ts'], ['Read b.ts', 'body']);
      const broken = logs.filter((entry) => entry.event === 'fold-broken');
      expect(broken).toEqual([
        { event: 'fold-broken', data: { mode: 'kind-unit', groupKey: 'c1' } },
      ]);
      expect(broken[0]?.data.groupKey).toBe(appliedKey);
    } finally {
      restore();
    }
  });
});

describe('createDashboardRenderedToolRuntime registerFold metadata-less individual fold', () => {
  test('toggling a !operationKind fold does not emit unjoinable fold-expanded or fold-recollapsed', () => {
    const { logs, restore } = collectFoldLogs();
    try {
      const { foldStack, runtime } = makeRuntime();
      runtime.replaceBlock('c1', ['Read a.ts'], 0);
      runtime.registerFold('c1', ['Read a.ts'], ['Read a.ts', 'body']);
      logs.length = 0;
      expect(foldStack.toggleAtLine(0)).toBe(true);
      const transitions = logs.filter((entry) => (
        entry.event === 'fold-expanded'
        || entry.event === 'fold-recollapsed'
        || entry.event === 'fold-broken'
      ));
      expect(transitions).toHaveLength(1);
      const transition = transitions[0]!;
      expect(transition.event).toBe('fold-expanded');
      expect(transition.data.mode).toBeNull();
      expect(transition.data.groupKey).toBeNull();
      expect(transition.data.lineIndex).toBe(0);
      expect(transition.data.lineStart).toBe(0);
      expect(transition.data.lineEnd).toBe(1);
    } finally {
      restore();
    }
  });
});

describe('createDashboardRenderedToolRuntime registerFold overfire: no toggle', () => {
  test('operations that do not toggle a fold emit none of the three side-effect events', () => {
    const { logs, restore } = collectFoldLogs();
    try {
      const { foldStack, runtime } = makeRuntime();
      runtime.replaceBlock('c1', ['Read a.ts'], 0);
      runtime.registerFold('c1', ['Read a.ts'], ['Read a.ts', 'body'], { operationKind: 'Read' });
      runtime.replaceBlock('c2', ['Read b.ts'], 1);
      runtime.registerFold('c2', ['Read b.ts'], ['Read b.ts', 'body'], { operationKind: 'Read' });
      expect(foldStack.toggleAtLine(9)).toBe(false);
      expect(foldStack.isExpandedFirstLine(0)).toBe(false);
      expect(logs.filter((entry) => (
        entry.event === 'fold-expanded'
        || entry.event === 'fold-recollapsed'
        || entry.event === 'fold-broken'
      ))).toEqual([]);
    } finally {
      restore();
    }
  });
});

describe('createDashboardRenderedToolRuntime registerFold overfire: apply without expand', () => {
  test('fold-applied alone leaves fold-expanded at zero', () => {
    const { logs, restore } = collectFoldLogs();
    try {
      const { runtime } = makeRuntime();
      runtime.replaceBlock('c1', ['Read a.ts'], 0);
      runtime.registerFold('c1', ['Read a.ts'], ['Read a.ts', 'body'], { operationKind: 'Read' });
      expect(logs.filter((entry) => entry.event === 'fold-applied').length).toBeGreaterThan(0);
      expect(logs.filter((entry) => entry.event === 'fold-expanded')).toHaveLength(0);
    } finally {
      restore();
    }
  });
});

describe('createDashboardRenderedToolRuntime fold-applied preservation', () => {
  test('fold-applied keeps the same field names and values for the same registerFold input', () => {
    const { logs, restore } = collectFoldLogs();
    try {
      const { runtime } = makeRuntime();
      runtime.replaceBlock('c1', ['Read a.ts'], 0);
      runtime.registerFold('c1', ['Read a.ts'], ['Read a.ts', 'body'], { operationKind: 'Read' });
      const applied = logs.filter((entry) => entry.event === 'fold-applied');
      expect(applied).toHaveLength(1);
      const record = applied[0]!;
      expect(record.event).toBe('fold-applied');
      expect(record.data.mode).toBe('kind-unit');
      expect(record.data.count).toBe(1);
      expect(record.data.groupKey).toBe('c1');
      expect(record.data.collapsedLineCount).toBe(1);
      expect(record.data.expandedLineCount).toBe(2);
    } finally {
      restore();
    }
  });
});
