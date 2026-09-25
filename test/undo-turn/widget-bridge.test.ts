// PLAN §4.7 · Arc 2.3 — UndoTurn time-travel slider bridge tests.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  buildSliderState, moveSliderCursor, setSliderCursor,
  renderSliderBar, renderSliderDetail, restoreToCursor,
  pushSnapshot, clearSnapshots, __resetSnapshotStore,
  type Snapshot, type RestoreResult,
} from '../../src/undo-turn/index.js';

function makeSnap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    id: '1234abcd',
    sha: '0123456789abcdef0123456789abcdef01234567',
    parentSha: 'fedcba9876543210fedcba9876543210fedcba98',
    repoRoot: '/tmp/repo',
    gitDir: '/tmp/repo/.git',
    untrackedFiles: [],
    capturedAt: 1_700_000_000_000,
    ...over,
  };
}

beforeEach(() => {
  __resetSnapshotStore();
  clearSnapshots();
});

afterEach(() => {
  __resetSnapshotStore();
  clearSnapshots();
});

describe('buildSliderState — empty store', () => {
  test('returns empty entries + cursor=-1', () => {
    const state = buildSliderState();
    expect(state.entries).toEqual([]);
    expect(state.cursor).toBe(-1);
  });
});

describe('buildSliderState — populated store', () => {
  test('cursor lands on the most recent entry', () => {
    pushSnapshot(makeSnap({ id: 'aaaaaaaa', capturedAt: 1_000 }));
    pushSnapshot(makeSnap({ id: 'bbbbbbbb', capturedAt: 2_000 }));
    pushSnapshot(makeSnap({ id: 'cccccccc', capturedAt: 3_000 }));
    const state = buildSliderState();
    expect(state.entries.length).toBe(3);
    expect(state.entries[0]?.id).toBe('aaaaaaaa');
    expect(state.entries[2]?.id).toBe('cccccccc');
    expect(state.cursor).toBe(2);
  });

  test('age seconds compute from `now` argument', () => {
    pushSnapshot(makeSnap({ capturedAt: 100_000 }));
    const state = buildSliderState(105_000);
    expect(state.entries[0]?.ageSec).toBe(5);
  });

  test('shaShort is first 7 chars', () => {
    pushSnapshot(makeSnap({ sha: 'abcdef0123456789' + '0'.repeat(24) }));
    const state = buildSliderState();
    expect(state.entries[0]?.shaShort).toBe('abcdef0');
  });

  test('description carries through when present', () => {
    pushSnapshot(makeSnap({ description: 'turn 5 — fix off-by-one' }));
    const state = buildSliderState();
    expect(state.entries[0]?.description).toBe('turn 5 — fix off-by-one');
  });
});

describe('moveSliderCursor', () => {
  function populated(): ReturnType<typeof buildSliderState> {
    pushSnapshot(makeSnap({ id: 'aaaaaaaa', capturedAt: 1_000 }));
    pushSnapshot(makeSnap({ id: 'bbbbbbbb', capturedAt: 2_000 }));
    pushSnapshot(makeSnap({ id: 'cccccccc', capturedAt: 3_000 }));
    return buildSliderState();
  }

  test('positive delta moves forward', () => {
    const initial = populated();
    const moved = moveSliderCursor({ ...initial, cursor: 0 }, 1);
    expect(moved.cursor).toBe(1);
  });

  test('negative delta moves backward', () => {
    const initial = populated();
    const moved = moveSliderCursor(initial, -1);
    expect(moved.cursor).toBe(1); // started at 2, -1 → 1
  });

  test('clamps at lower bound', () => {
    const initial = populated();
    const moved = moveSliderCursor({ ...initial, cursor: 0 }, -5);
    expect(moved.cursor).toBe(0);
  });

  test('clamps at upper bound', () => {
    const initial = populated();
    const moved = moveSliderCursor(initial, 10);
    expect(moved.cursor).toBe(2);
  });

  test('returns same reference when no movement', () => {
    const initial = populated();
    const moved = moveSliderCursor(initial, 0);
    expect(moved).toBe(initial);
  });

  test('no-op when entries are empty', () => {
    const empty = buildSliderState();
    const moved = moveSliderCursor(empty, 5);
    expect(moved).toBe(empty);
  });
});

describe('setSliderCursor', () => {
  test('sets cursor to absolute index', () => {
    pushSnapshot(makeSnap({ id: 'aaaaaaaa', capturedAt: 1_000 }));
    pushSnapshot(makeSnap({ id: 'bbbbbbbb', capturedAt: 2_000 }));
    pushSnapshot(makeSnap({ id: 'cccccccc', capturedAt: 3_000 }));
    const state = setSliderCursor(buildSliderState(), 1);
    expect(state.cursor).toBe(1);
  });

  test('clamps to bounds', () => {
    pushSnapshot(makeSnap({ id: 'aaaaaaaa', capturedAt: 1_000 }));
    const state = setSliderCursor(buildSliderState(), 99);
    expect(state.cursor).toBe(0);
  });
});

describe('renderSliderBar', () => {
  test('renders empty placeholder', () => {
    expect(renderSliderBar(buildSliderState())).toBe('(no snapshots)');
  });

  test('marks cursor with ◉ and others with ●', () => {
    pushSnapshot(makeSnap({ id: 'aaaaaaaa', capturedAt: 1_000 }));
    pushSnapshot(makeSnap({ id: 'bbbbbbbb', capturedAt: 2_000 }));
    pushSnapshot(makeSnap({ id: 'cccccccc', capturedAt: 3_000 }));
    const bar = renderSliderBar(setSliderCursor(buildSliderState(), 1));
    expect(bar).toContain('◉');
    expect(bar).toContain('●');
    // Cursor at index 1 of 3 → middle marker.
    expect(bar).toBe('●─◉─●');
  });

  test('width cap pads with ─', () => {
    pushSnapshot(makeSnap({ id: 'aaaaaaaa' }));
    const bar = renderSliderBar(buildSliderState(), { width: 5 });
    // 1 marker + padding to 5 → 1 of ◉ + 4 fillers separated by ─
    expect(bar.length).toBeGreaterThan(1);
  });
});

describe('renderSliderDetail', () => {
  test('returns empty-state hint when store is empty', () => {
    const lines = renderSliderDetail(buildSliderState());
    expect(lines.join(' ')).toContain('no snapshots');
  });

  test('renders bar + position + sha + age', () => {
    pushSnapshot(makeSnap({ id: 'aaaaaaaa', capturedAt: 1_000 }));
    pushSnapshot(makeSnap({ id: 'bbbbbbbb', capturedAt: 2_000 }));
    const lines = renderSliderDetail(buildSliderState(5_000));
    expect(lines[0]).toContain('◉');
    expect(lines[1]).toMatch(/turn 2 \/ 2/);
    expect(lines[1]).toContain('bbbbbbbb');
    expect(lines[1]).toMatch(/\d+s ago/);
  });

  test('appends description when present', () => {
    pushSnapshot(makeSnap({ description: 'turn 7 - refactor cache' }));
    const lines = renderSliderDetail(buildSliderState());
    const descLine = lines.find((l) => l.includes('description'));
    expect(descLine).toBeDefined();
    expect(descLine).toContain('refactor cache');
  });
});

describe('restoreToCursor', () => {
  function mockOk(): RestoreResult {
    return { ok: true, untrackedRemoved: 0, summary: 'restored test snapshot' };
  }

  test('returns error when slider is empty', () => {
    const result = restoreToCursor(buildSliderState(), mockOk);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('no snapshots');
  });

  test('dispatches the injected restore fn for the cursor entry', () => {
    pushSnapshot(makeSnap({ id: 'aaaaaaaa', capturedAt: 1_000 }));
    pushSnapshot(makeSnap({ id: 'bbbbbbbb', capturedAt: 2_000 }));
    let dispatched: Snapshot | null = null;
    const fn = (snap: Snapshot): RestoreResult => {
      dispatched = snap;
      return mockOk();
    };
    const state = setSliderCursor(buildSliderState(), 0);
    const result = restoreToCursor(state, fn);
    expect(result.ok).toBe(true);
    expect((dispatched as unknown as Snapshot)?.id).toBe('aaaaaaaa');
  });

  test('reports lookup miss when snapshot vanished from store', () => {
    pushSnapshot(makeSnap({ id: 'aaaaaaaa' }));
    const state = buildSliderState();
    clearSnapshots(); // simulate ring rotation between build + restore
    const result = restoreToCursor(state, mockOk);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('removed from the ring');
  });
});
