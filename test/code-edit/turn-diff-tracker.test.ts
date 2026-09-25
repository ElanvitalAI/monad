import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import chalk from 'chalk';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { promises as fsp } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  TurnDiffTracker, renderTurnSummary,
  applyEdit, applyWrite, applyRead,
  ReadFileStateStore,
  setPolicy, resetPolicyToDefault,
  _setTurnDiffTrackerForTesting,
  getTurnDiffTracker,
} from '../../src/code-edit/index.js';

const dirs: string[] = [];
function mkdir(): string {
  const d = mkdtempSync(join(tmpdir(), 'ce-tdt-'));
  dirs.push(d);
  return d;
}

beforeEach(() => {
  setPolicy({ mode: 'unsupervised' });
  _setTurnDiffTrackerForTesting(new TurnDiffTracker());
});

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  resetPolicyToDefault();
  _setTurnDiffTrackerForTesting(null);
});

describe('TurnDiffTracker — standalone', () => {
  test('onBeforeEdit records only the first touch per path', () => {
    const t = new TurnDiffTracker();
    t.onBeforeEdit('/a', 'v1');
    t.onBeforeEdit('/a', 'v2'); // should be ignored
    expect(t.hasBaseline('/a')).toBe(true);
    expect(t.size()).toBe(1);
  });

  test('turnSummary computes net diff vs baseline', async () => {
    const t = new TurnDiffTracker();
    t.onBeforeEdit('/a', 'one\n');
    const entries = await t.turnSummary(async () => 'one\nTWO\n');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.path).toBe('/a');
    expect(entries[0]!.added).toBe(1);
    expect(entries[0]!.removed).toBe(0);
    expect(entries[0]!.created).toBe(false);
  });

  test('touched-then-reverted is filtered out by default', async () => {
    const t = new TurnDiffTracker();
    t.onBeforeEdit('/a', 'same');
    const entries = await t.turnSummary(async () => 'same');
    expect(entries).toEqual([]);
  });

  test('includeUnchanged surfaces touched-then-reverted entries', async () => {
    const t = new TurnDiffTracker();
    t.onBeforeEdit('/a', 'same');
    const entries = await t.turnSummary(async () => 'same', { includeUnchanged: true });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.added).toBe(0);
    expect(entries[0]!.removed).toBe(0);
  });

  test('baseline existed=false + current exists → created:true', async () => {
    const t = new TurnDiffTracker();
    t.onBeforeEdit('/new', null);
    const entries = await t.turnSummary(async () => 'hi');
    expect(entries[0]!.created).toBe(true);
  });

  test('baseline existed + current missing → deleted:true', async () => {
    const t = new TurnDiffTracker();
    t.onBeforeEdit('/gone', 'was here');
    const entries = await t.turnSummary(async () => null);
    expect(entries[0]!.deleted).toBe(true);
  });

  test('entries sorted by path for deterministic rendering', async () => {
    const t = new TurnDiffTracker();
    t.onBeforeEdit('/z', 'z');
    t.onBeforeEdit('/a', 'a');
    t.onBeforeEdit('/m', 'm');
    const entries = await t.turnSummary(async (p) =>
      p === '/z' ? 'Z' : p === '/a' ? 'A' : 'M');
    expect(entries.map((e) => e.path)).toEqual(['/a', '/m', '/z']);
  });

  test('endTurn wipes baselines', () => {
    const t = new TurnDiffTracker();
    t.onBeforeEdit('/a', 'v1');
    t.endTurn();
    expect(t.size()).toBe(0);
  });

  test('beginTurn also wipes (alias of endTurn in practice)', () => {
    const t = new TurnDiffTracker();
    t.onBeforeEdit('/a', 'v1');
    t.beginTurn();
    expect(t.size()).toBe(0);
  });
});

describe('applyEdit / applyWrite integration with singleton tracker', () => {
  test('chained edits on one file diff against the true start-of-turn content', async () => {
    const d = mkdir();
    const p = join(d, 'f.ts');
    writeFileSync(p, 'line1\nline2\nline3\n');
    const store = new ReadFileStateStore();
    await applyRead(p, store);

    await applyEdit({ file_path: p, edits: [{ old_string: 'line1', new_string: 'L1' }] }, store);
    await applyEdit({ file_path: p, edits: [{ old_string: 'line2', new_string: 'L2' }] }, store);
    await applyEdit({ file_path: p, edits: [{ old_string: 'line3', new_string: 'L3' }] }, store);

    const tracker = getTurnDiffTracker();
    const entries = await tracker.turnSummary(async (fp) => fsp.readFile(fp, 'utf-8'));
    expect(entries).toHaveLength(1);
    // Net change: three lines replaced.
    expect(entries[0]!.added).toBe(3);
    expect(entries[0]!.removed).toBe(3);
  });

  test('multiple files → multiple entries sorted by path', async () => {
    const d = mkdir();
    const a = join(d, 'a.ts');
    const b = join(d, 'b.ts');
    writeFileSync(a, 'A\n');
    writeFileSync(b, 'B\n');
    const store = new ReadFileStateStore();
    await applyRead(a, store);
    await applyRead(b, store);

    await applyEdit({ file_path: a, edits: [{ old_string: 'A', new_string: 'AA' }] }, store);
    await applyEdit({ file_path: b, edits: [{ old_string: 'B', new_string: 'BB' }] }, store);

    const tracker = getTurnDiffTracker();
    const entries = await tracker.turnSummary(async (p) => fsp.readFile(p, 'utf-8'));
    expect(entries).toHaveLength(2);
  });

  test('applyWrite on a new file → created:true in summary', async () => {
    const d = mkdir();
    const p = join(d, 'new.md');
    const store = new ReadFileStateStore();

    await applyWrite({ file_path: p, content: '# hi\n' }, store);
    const tracker = getTurnDiffTracker();
    const entries = await tracker.turnSummary(async (fp) => fsp.readFile(fp, 'utf-8'));
    expect(entries).toHaveLength(1);
    expect(entries[0]!.created).toBe(true);
  });
});

describe('renderTurnSummary', () => {
  beforeEach(() => { chalk.level = 3; });

  test('empty entries → empty array', () => {
    expect(renderTurnSummary([])).toEqual([]);
  });

  test('single entry produces title + one row', () => {
    const rows = renderTurnSummary([
      { path: '/a.ts', patch: [], added: 3, removed: 1, created: false, deleted: false },
    ]);
    expect(rows.length).toBe(2);
    expect(rows[0]).toContain('Turn summary');
    expect(rows[0]).toContain('1 file');
    expect(rows[1]).toContain('/a.ts');
    expect(rows[1]).toContain('+3 / -1');
  });

  test('plural files vs singular file phrasing', () => {
    const one = renderTurnSummary([
      { path: '/a', patch: [], added: 1, removed: 0, created: false, deleted: false },
    ]);
    const many = renderTurnSummary([
      { path: '/a', patch: [], added: 1, removed: 0, created: false, deleted: false },
      { path: '/b', patch: [], added: 2, removed: 0, created: false, deleted: false },
    ]);
    expect(one[0]).toContain('1 file ');
    expect(many[0]).toContain('2 files');
  });

  test('created / deleted verbs', () => {
    const rows = renderTurnSummary([
      { path: '/new.md', patch: [], added: 2, removed: 0, created: true, deleted: false },
      { path: '/gone.md', patch: [], added: 0, removed: 5, created: false, deleted: true },
      { path: '/upd.md', patch: [], added: 1, removed: 1, created: false, deleted: false },
    ]);
    const joined = rows.join('\n');
    expect(joined).toContain('create');
    expect(joined).toContain('delete');
    expect(joined).toContain('update');
  });
});
