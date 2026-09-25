import { describe, expect, spyOn, test } from 'bun:test';

import { debug } from './debug/log.js';
import { FoldStack, TOGGLE_AT_LINE_MISS_CANDIDATE_LIMIT } from './fold-stack.js';

type FoldLog = {
  event: string;
  mode?: unknown;
  groupKey?: unknown;
  lineIndex?: unknown;
  lineStart?: unknown;
  lineEnd?: unknown;
};

function collectFoldLogs(): { logs: FoldLog[]; restore: () => void } {
  const logs: FoldLog[] = [];
  const spy = spyOn(debug, 'log').mockImplementation(((category: string, event: string, data?: Record<string, unknown>) => {
    if (category === 'log.fold') {
      logs.push({
        event,
        mode: data?.mode,
        groupKey: data?.groupKey,
        lineIndex: data?.lineIndex,
        lineStart: data?.lineStart,
        lineEnd: data?.lineEnd,
      });
    }
  }) as typeof debug.log);
  return { logs, restore: () => spy.mockRestore() };
}

type FoldMissLog = {
  event: string;
  lineIndex?: unknown;
  candidates?: unknown;
  truncated?: unknown;
  mode?: unknown;
  groupKey?: unknown;
  lineStart?: unknown;
  lineEnd?: unknown;
};

function collectFoldMissLogs(): { logs: FoldMissLog[]; restore: () => void } {
  const logs: FoldMissLog[] = [];
  const spy = spyOn(debug, 'log').mockImplementation(((category: string, event: string, data?: Record<string, unknown>) => {
    if (category === 'log.fold') {
      logs.push({
        event,
        lineIndex: data?.lineIndex,
        candidates: data?.candidates,
        truncated: data?.truncated,
        mode: data?.mode,
        groupKey: data?.groupKey,
        lineStart: data?.lineStart,
        lineEnd: data?.lineEnd,
      });
    }
  }) as typeof debug.log);
  return { logs, restore: () => spy.mockRestore() };
}

describe('FoldStack range shifting used by kind-unit coalescing', () => {
  test('shiftStatic still moves a later static fold when an earlier block shrinks', () => {
    const chatLines = ['a', 'b', 'c'];
    const stack = new FoldStack({ chatLines });
    const later = stack.push({
      kind: 'static',
      expanded: false,
      lineStart: 2,
      lineEnd: 3,
      rerender: (isExpanded) => isExpanded ? ['c', 'c2'] : ['c'],
    });
    stack.shiftStatic(later, -1);
    chatLines.splice(0, 1);
    expect(stack.toggleTop()).toBe(true);
    expect(chatLines).toEqual(['b', 'c', 'c2']);
  });
});

describe('FoldStack toggleAtLine / isExpandedFirstLine', () => {
  test('a line inside a collapsed static range expands it', () => {
    const chatLines = ['a', 'b', 'c'];
    const stack = new FoldStack({ chatLines });
    stack.push({
      kind: 'static',
      expanded: false,
      lineStart: 1,
      lineEnd: 3,
      rerender: (isExpanded) => isExpanded ? ['b', 'b2', 'c'] : ['b', 'c'],
    });
    expect(stack.toggleAtLine(2)).toBe(true);
    expect(chatLines).toEqual(['a', 'b', 'b2', 'c']);
    expect(stack.snapshot()[0]?.expanded).toBe(true);
  });

  test('a line outside every range is a no-op false', () => {
    const chatLines = ['a', 'b', 'c'];
    const stack = new FoldStack({ chatLines });
    stack.push({
      kind: 'static',
      expanded: false,
      lineStart: 0,
      lineEnd: 1,
      rerender: (isExpanded) => isExpanded ? ['a', 'a2'] : ['a'],
    });
    const before = chatLines.slice();
    expect(stack.toggleAtLine(2)).toBe(false);
    expect(chatLines).toEqual(before);
    expect(stack.snapshot()[0]?.expanded).toBe(false);
  });

  test('overlapping ranges toggle the later-pushed target', () => {
    const chatLines = ['0', '1', '2', '3', '4'];
    const stack = new FoldStack({ chatLines });
    stack.push({
      kind: 'static',
      expanded: false,
      lineStart: 0,
      lineEnd: 5,
      rerender: (isExpanded) => isExpanded ? ['0', '1', '2', '3', '4', 'outer'] : ['0', '1', '2', '3', '4'],
    });
    stack.push({
      kind: 'static',
      expanded: false,
      lineStart: 1,
      lineEnd: 3,
      rerender: (isExpanded) => isExpanded ? ['1', 'inner', '2'] : ['1', '2'],
    });
    expect(stack.toggleAtLine(1)).toBe(true);
    const snap = stack.snapshot();
    expect(snap[0]?.expanded).toBe(false);
    expect(snap[1]?.expanded).toBe(true);
    expect(chatLines).toEqual(['0', '1', 'inner', '2', '3', '4']);
  });

  test('live callback targets are ignored', () => {
    const chatLines = ['x'];
    let liveRerendered = false;
    const stack = new FoldStack({ chatLines });
    stack.push({
      kind: 'live',
      expanded: false,
      rerender: () => { liveRerendered = true; },
    });
    const before = chatLines.slice();
    expect(stack.toggleAtLine(0)).toBe(false);
    expect(chatLines).toEqual(before);
    expect(stack.snapshot()[0]?.expanded).toBe(false);
    expect(liveRerendered).toBe(false);
  });

  test('reports whether a line is the first line of an expanded static range', () => {
    const chatLines = ['a', 'b', 'c'];
    const stack = new FoldStack({ chatLines });
    stack.push({
      kind: 'static',
      expanded: true,
      lineStart: 0,
      lineEnd: 3,
      rerender: (isExpanded) => isExpanded ? ['a', 'b', 'c'] : ['a'],
    });
    expect(stack.isExpandedFirstLine(0)).toBe(true);
    expect(stack.isExpandedFirstLine(1)).toBe(false);
    expect(stack.isExpandedFirstLine(2)).toBe(false);
  });

  test('toggleTop still toggles the most recently pushed target', () => {
    const chatLines = ['a', 'b'];
    const stack = new FoldStack({ chatLines });
    stack.push({
      kind: 'static',
      expanded: false,
      lineStart: 0,
      lineEnd: 1,
      rerender: (isExpanded) => isExpanded ? ['a', 'a2'] : ['a'],
    });
    stack.push({
      kind: 'static',
      expanded: false,
      lineStart: 1,
      lineEnd: 2,
      rerender: (isExpanded) => isExpanded ? ['b', 'b2'] : ['b'],
    });
    expect(stack.toggleTop()).toBe(true);
    expect(chatLines).toEqual(['a', 'b', 'b2']);
    expect(stack.snapshot()[0]?.expanded).toBe(false);
    expect(stack.snapshot()[1]?.expanded).toBe(true);
  });

  test('toggleAll still expands every collapsed static when fewer than half are expanded', () => {
    const chatLines = ['a', 'b'];
    const stack = new FoldStack({ chatLines });
    stack.push({
      kind: 'static',
      expanded: false,
      lineStart: 0,
      lineEnd: 1,
      rerender: (isExpanded) => isExpanded ? ['a', 'a2'] : ['a'],
    });
    stack.push({
      kind: 'static',
      expanded: false,
      lineStart: 1,
      lineEnd: 2,
      rerender: (isExpanded) => isExpanded ? ['b', 'b2'] : ['b'],
    });
    expect(stack.toggleAll()).toBe(2);
    expect(chatLines).toEqual(['a', 'a2', 'b', 'b2']);
    expect(stack.snapshot().every(t => t.expanded)).toBe(true);
  });
});

describe('FoldStack toggleAtLine fold-expanded observation', () => {
  test('expanding a collapsed target emits one fold-expanded with the target group identifier and mode', () => {
    const { logs, restore } = collectFoldLogs();
    try {
      const chatLines = ['a'];
      const stack = new FoldStack({ chatLines });
      stack.push({
        kind: 'static',
        expanded: false,
        lineStart: 0,
        lineEnd: 1,
        rerender: (isExpanded) => isExpanded ? ['a', 'a2'] : ['a'],
        mode: 'kind-unit',
        groupKey: 'c1',
      });
      expect(stack.toggleAtLine(0)).toBe(true);
      expect(chatLines).toEqual(['a', 'a2']);
      expect(stack.snapshot()[0]?.expanded).toBe(true);
      expect(logs.filter((entry) => entry.event === 'fold-expanded')).toEqual([
        {
          event: 'fold-expanded',
          mode: 'kind-unit',
          groupKey: 'c1',
          lineIndex: 0,
          lineStart: 0,
          lineEnd: 1,
        },
      ]);
    } finally {
      restore();
    }
  });
});

describe('FoldStack toggleAtLine fold-recollapsed observation', () => {
  test('recollapsing an expanded target emits fold-recollapsed and not fold-expanded', () => {
    const chatLines = ['a', 'a2'];
    const stack = new FoldStack({ chatLines });
    stack.push({
      kind: 'static',
      expanded: true,
      lineStart: 0,
      lineEnd: 2,
      rerender: (isExpanded) => isExpanded ? ['a', 'a2'] : ['a'],
      mode: 'kind-unit',
      groupKey: 'c1',
    });
    const { logs, restore } = collectFoldLogs();
    try {
      expect(stack.toggleAtLine(0)).toBe(true);
      expect(chatLines).toEqual(['a']);
      expect(stack.snapshot()[0]?.expanded).toBe(false);
      expect(logs.filter((entry) => entry.event === 'fold-recollapsed')).toEqual([
        {
          event: 'fold-recollapsed',
          mode: 'kind-unit',
          groupKey: 'c1',
          lineIndex: 0,
          lineStart: 0,
          lineEnd: 2,
        },
      ]);
      expect(logs.filter((entry) => entry.event === 'fold-expanded')).toEqual([]);
    } finally {
      restore();
    }
  });
});

describe('FoldStack non-toggle operations emit no fold side-effect events', () => {
  test('missed toggleAtLine and isExpandedFirstLine emit none of the three events', () => {
    const { logs, restore } = collectFoldLogs();
    try {
      const chatLines = ['a', 'b', 'c'];
      const stack = new FoldStack({ chatLines });
      stack.push({
        kind: 'static',
        expanded: false,
        lineStart: 0,
        lineEnd: 1,
        rerender: (isExpanded) => isExpanded ? ['a', 'a2'] : ['a'],
        mode: 'kind-unit',
        groupKey: 'c1',
      });
      expect(stack.toggleAtLine(2)).toBe(false);
      expect(stack.isExpandedFirstLine(0)).toBe(false);
      expect(stack.isExpandedFirstLine(2)).toBe(false);
      expect(logs.filter((entry) => (
        entry.event === 'fold-expanded'
        || entry.event === 'fold-recollapsed'
        || entry.event === 'fold-broken'
      ))).toEqual([]);
      expect(chatLines).toEqual(['a', 'b', 'c']);
      expect(stack.snapshot()[0]?.expanded).toBe(false);
    } finally {
      restore();
    }
  });
});

describe('FoldStack toggleAtLine metadata-less existing folds still emit success observations', () => {
  test('a successful toggle without mode and groupKey still emits fold-expanded then fold-recollapsed with absent metadata', () => {
    const chatLines = ['a'];
    const stack = new FoldStack({ chatLines });
    stack.push({
      kind: 'static',
      expanded: false,
      lineStart: 0,
      lineEnd: 1,
      rerender: (isExpanded) => isExpanded ? ['a', 'a2'] : ['a'],
    });
    const { logs, restore } = collectFoldLogs();
    try {
      expect(stack.toggleAtLine(0)).toBe(true);
      expect(chatLines).toEqual(['a', 'a2']);
      expect(stack.snapshot()[0]?.expanded).toBe(true);
      expect(logs.filter((entry) => entry.event === 'fold-expanded')).toEqual([
        {
          event: 'fold-expanded',
          mode: null,
          groupKey: null,
          lineIndex: 0,
          lineStart: 0,
          lineEnd: 1,
        },
      ]);
      expect(logs.filter((entry) => entry.event === 'fold-recollapsed')).toEqual([]);
      expect(logs.filter((entry) => entry.event === 'fold-broken')).toEqual([]);

      expect(stack.toggleAtLine(0)).toBe(true);
      expect(chatLines).toEqual(['a']);
      expect(stack.snapshot()[0]?.expanded).toBe(false);
      expect(logs.filter((entry) => entry.event === 'fold-recollapsed')).toEqual([
        {
          event: 'fold-recollapsed',
          mode: null,
          groupKey: null,
          lineIndex: 0,
          lineStart: 0,
          lineEnd: 2,
        },
      ]);
    } finally {
      restore();
    }
  });

  test('a successful toggle missing only one of mode or groupKey still emits with the missing field as null', () => {
    const chatLines = ['a', 'b'];
    const stack = new FoldStack({ chatLines });
    stack.push({
      kind: 'static',
      expanded: false,
      lineStart: 0,
      lineEnd: 1,
      rerender: (isExpanded) => isExpanded ? ['A'] : ['a'],
      mode: 'kind-unit',
    });
    stack.push({
      kind: 'static',
      expanded: false,
      lineStart: 1,
      lineEnd: 2,
      rerender: (isExpanded) => isExpanded ? ['B'] : ['b'],
      groupKey: 'c2',
    });
    const { logs, restore } = collectFoldLogs();
    try {
      expect(stack.toggleAtLine(0)).toBe(true);
      expect(stack.toggleAtLine(1)).toBe(true);
      expect(logs.filter((entry) => entry.event === 'fold-expanded')).toEqual([
        {
          event: 'fold-expanded',
          mode: 'kind-unit',
          groupKey: null,
          lineIndex: 0,
          lineStart: 0,
          lineEnd: 1,
        },
        {
          event: 'fold-expanded',
          mode: null,
          groupKey: 'c2',
          lineIndex: 1,
          lineStart: 1,
          lineEnd: 2,
        },
      ]);
    } finally {
      restore();
    }
  });
});

describe('FoldStack toggleAtLine success observation correlates requested line with selected exclusive range', () => {
  test('emitted lineStart/lineEnd contain the requested lineIndex and match the selected fold', () => {
    const chatLines = ['a', 'b', 'c', 'd'];
    const stack = new FoldStack({ chatLines });
    stack.push({
      kind: 'static',
      expanded: false,
      lineStart: 1,
      lineEnd: 4,
      rerender: (isExpanded) => isExpanded ? ['b', 'b2', 'c', 'd'] : ['b', 'c', 'd'],
    });
    const { logs, restore } = collectFoldLogs();
    try {
      const requested = 2;
      expect(stack.toggleAtLine(requested)).toBe(true);
      const expanded = logs.filter((entry) => entry.event === 'fold-expanded');
      expect(expanded).toHaveLength(1);
      const lineStart = expanded[0]?.lineStart;
      const lineEnd = expanded[0]?.lineEnd;
      expect(expanded[0]?.lineIndex).toBe(requested);
      expect(typeof lineStart).toBe('number');
      expect(typeof lineEnd).toBe('number');
      expect(requested >= (lineStart as number) && requested < (lineEnd as number)).toBe(true);
      expect(lineStart).toBe(1);
      expect(lineEnd).toBe(4);
    } finally {
      restore();
    }
  });

  test('overlapping ranges still select the later-pushed static fold and log that exclusive range', () => {
    const chatLines = ['0', '1', '2', '3', '4'];
    const stack = new FoldStack({ chatLines });
    stack.push({
      kind: 'static',
      expanded: false,
      lineStart: 0,
      lineEnd: 5,
      rerender: (isExpanded) => isExpanded ? ['0', '1', '2', '3', '4', 'outer'] : ['0', '1', '2', '3', '4'],
    });
    stack.push({
      kind: 'static',
      expanded: false,
      lineStart: 1,
      lineEnd: 3,
      rerender: (isExpanded) => isExpanded ? ['1', 'inner', '2'] : ['1', '2'],
    });
    const { logs, restore } = collectFoldLogs();
    try {
      expect(stack.toggleAtLine(1)).toBe(true);
      const snap = stack.snapshot();
      expect(snap[0]?.expanded).toBe(false);
      expect(snap[1]?.expanded).toBe(true);
      expect(chatLines).toEqual(['0', '1', 'inner', '2', '3', '4']);
      expect(logs.filter((entry) => entry.event === 'fold-expanded')).toEqual([
        {
          event: 'fold-expanded',
          mode: null,
          groupKey: null,
          lineIndex: 1,
          lineStart: 1,
          lineEnd: 3,
        },
      ]);
    } finally {
      restore();
    }
  });
});

describe('FoldStack toggleAtLine / isExpandedFirstLine preservation', () => {
  test('toggleAtLine still returns true and expands the same range after observation is added', () => {
    const chatLines = ['a', 'b', 'c'];
    const stack = new FoldStack({ chatLines });
    stack.push({
      kind: 'static',
      expanded: false,
      lineStart: 1,
      lineEnd: 3,
      rerender: (isExpanded) => isExpanded ? ['b', 'b2', 'c'] : ['b', 'c'],
    });
    expect(stack.toggleAtLine(2)).toBe(true);
    expect(chatLines).toEqual(['a', 'b', 'b2', 'c']);
    expect(stack.snapshot()[0]?.expanded).toBe(true);
  });

  test('isExpandedFirstLine still reports only the first line of an expanded static range', () => {
    const chatLines = ['a', 'b', 'c'];
    const stack = new FoldStack({ chatLines });
    stack.push({
      kind: 'static',
      expanded: true,
      lineStart: 0,
      lineEnd: 3,
      rerender: (isExpanded) => isExpanded ? ['a', 'b', 'c'] : ['a'],
    });
    expect(stack.isExpandedFirstLine(0)).toBe(true);
    expect(stack.isExpandedFirstLine(1)).toBe(false);
    expect(stack.isExpandedFirstLine(2)).toBe(false);
  });
});

describe('FoldStack toggleAtLine miss observation', () => {
  test('zero static candidates emit one miss observation that shows no candidates', () => {
    const { logs, restore } = collectFoldMissLogs();
    try {
      const chatLines = ['a'];
      const stack = new FoldStack({ chatLines });
      expect(stack.toggleAtLine(3)).toBe(false);
      const misses = logs.filter((entry) => entry.event === 'toggle-at-line-miss');
      expect(misses).toHaveLength(1);
      expect(misses[0]?.lineIndex).toBe(3);
      expect(misses[0]?.candidates).toEqual([]);
      expect(misses[0]?.truncated).toBe(false);
    } finally {
      restore();
    }
  });

  test('nonmatching static candidates emit a miss observation distinguishable from zero candidates', () => {
    const { logs, restore } = collectFoldMissLogs();
    try {
      const chatLines = ['a', 'b', 'c'];
      const stack = new FoldStack({ chatLines });
      stack.push({
        kind: 'static',
        expanded: false,
        lineStart: 0,
        lineEnd: 1,
        rerender: (isExpanded) => isExpanded ? ['a', 'a2'] : ['a'],
      });
      expect(stack.toggleAtLine(2)).toBe(false);
      const misses = logs.filter((entry) => entry.event === 'toggle-at-line-miss');
      expect(misses).toHaveLength(1);
      expect(misses[0]?.lineIndex).toBe(2);
      expect(misses[0]?.candidates).toEqual([{ lineStart: 0, lineEnd: 1 }]);
      expect(misses[0]?.truncated).toBe(false);
      expect((misses[0]?.candidates as unknown[]).length).toBeGreaterThan(0);
    } finally {
      restore();
    }
  });

  test('more static candidates than the cap mark truncation as true', () => {
    const { logs, restore } = collectFoldMissLogs();
    try {
      const chatLines = Array.from({ length: TOGGLE_AT_LINE_MISS_CANDIDATE_LIMIT + 1 }, (_, i) => String(i));
      const stack = new FoldStack({ chatLines });
      for (let i = 0; i < TOGGLE_AT_LINE_MISS_CANDIDATE_LIMIT + 1; i++) {
        stack.push({
          kind: 'static',
          expanded: false,
          lineStart: i,
          lineEnd: i + 1,
          rerender: () => [String(i)],
        });
      }
      const requested = TOGGLE_AT_LINE_MISS_CANDIDATE_LIMIT + 10;
      expect(stack.toggleAtLine(requested)).toBe(false);
      const misses = logs.filter((entry) => entry.event === 'toggle-at-line-miss');
      expect(misses).toHaveLength(1);
      expect(misses[0]?.lineIndex).toBe(requested);
      expect(misses[0]?.candidates).toEqual(
        Array.from({ length: TOGGLE_AT_LINE_MISS_CANDIDATE_LIMIT }, (_, i) => ({
          lineStart: i,
          lineEnd: i + 1,
        })),
      );
      expect(misses[0]?.truncated).toBe(true);
    } finally {
      restore();
    }
  });

  test('a successful toggle emits no miss observation and still emits the existing success observation', () => {
    const { logs, restore } = collectFoldMissLogs();
    try {
      const chatLines = ['a'];
      const stack = new FoldStack({ chatLines });
      stack.push({
        kind: 'static',
        expanded: false,
        lineStart: 0,
        lineEnd: 1,
        rerender: (isExpanded) => isExpanded ? ['a', 'a2'] : ['a'],
        mode: 'kind-unit',
        groupKey: 'c1',
      });
      expect(stack.toggleAtLine(0)).toBe(true);
      expect(logs.filter((entry) => entry.event === 'toggle-at-line-miss')).toEqual([]);
      expect(logs.filter((entry) => entry.event === 'fold-expanded')).toEqual([
        {
          event: 'fold-expanded',
          lineIndex: 0,
          candidates: undefined,
          truncated: undefined,
          mode: 'kind-unit',
          groupKey: 'c1',
          lineStart: 0,
          lineEnd: 1,
        },
      ]);
    } finally {
      restore();
    }
  });

  test('miss observation does not change the false return or fold state', () => {
    const { logs, restore } = collectFoldMissLogs();
    try {
      const chatLines = ['a', 'b', 'c'];
      const stack = new FoldStack({ chatLines });
      stack.push({
        kind: 'static',
        expanded: false,
        lineStart: 0,
        lineEnd: 1,
        rerender: (isExpanded) => isExpanded ? ['a', 'a2'] : ['a'],
      });
      const beforeLines = chatLines.slice();
      const beforeSnap = stack.snapshot();
      expect(stack.toggleAtLine(2)).toBe(false);
      expect(chatLines).toEqual(beforeLines);
      expect(stack.snapshot()).toEqual(beforeSnap);
      expect(stack.snapshot()[0]?.expanded).toBe(false);
      expect(logs.filter((entry) => entry.event === 'toggle-at-line-miss')).toHaveLength(1);
    } finally {
      restore();
    }
  });
});
