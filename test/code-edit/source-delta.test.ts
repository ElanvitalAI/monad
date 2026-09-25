import { beforeEach, describe, expect, test } from 'bun:test';
import {
  SourceDeltaManager,
  renderSourceDeltaTurnSummary,
} from '../../src/code-edit/index.js';
import type { EditResult } from '../../src/code-edit/index.js';

function mkResult(path: string, patch: EditResult['structuredPatch'], before = 'a\n', after = 'b\n'): EditResult {
  return {
    ok: true,
    file_path: path,
    structuredPatch: patch,
    originalContent: before,
    newContent: after,
    edits: [{ old_string: before, new_string: after }],
    linesAdded: patch.reduce((sum, hunk) => sum + hunk.lines.filter((line) => line.startsWith('+')).length, 0),
    linesRemoved: patch.reduce((sum, hunk) => sum + hunk.lines.filter((line) => line.startsWith('-')).length, 0),
  };
}

describe('SourceDeltaManager', () => {
  let manager: SourceDeltaManager;

  beforeEach(() => {
    manager = new SourceDeltaManager();
  });

  test('aggregates repeated edits on the same file inside one turn', () => {
    manager.beginTurn({ promptPreview: 'fix file' });
    manager.onEditResult(mkResult('/a.ts', [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+aa'] }]));
    const second = manager.onEditResult(mkResult('/a.ts', [{ oldStart: 2, oldLines: 1, newStart: 2, newLines: 1, lines: ['-b', '+bb'] }], 'aa\nb\n', 'aa\nbb\n'));
    expect(second.file.editCount).toBe(2);
    expect(second.file.linesAdded).toBe(2);
    expect(second.file.linesRemoved).toBe(2);
    expect(second.turn.stats.filesChanged).toBe(1);
    expect(second.turn.stats.edits).toBe(2);
  });

  test('endTurn returns a stable snapshot and clears current state', () => {
    manager.beginTurn({ promptPreview: 'create file' });
    manager.onEditResult(mkResult('/new.ts', [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: ['+hi'] }], '', 'hi\n'));
    const turn = manager.endTurn();
    expect(turn?.files).toHaveLength(1);
    expect(turn?.files[0]?.isNewFile).toBe(true);
    expect(manager.size()).toBe(0);
  });

  test('latestTurn prefers in-flight edits and then reopens the last completed turn', () => {
    expect(manager.latestTurn()).toBeNull();
    manager.beginTurn({ promptPreview: 'edit file' });
    manager.onEditResult(mkResult('/a.ts', [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+aa'] }]));
    expect(manager.latestTurn()?.files[0]?.filePath).toBe('/a.ts');
    const ended = manager.endTurn();
    expect(ended?.files[0]?.filePath).toBe('/a.ts');
    expect(manager.latestTurn()?.files[0]?.filePath).toBe('/a.ts');
    manager.reset();
    expect(manager.latestTurn()).toBeNull();
  });

  test('recentTurns returns current first then recent completed history', () => {
    manager.beginTurn({ promptPreview: 'turn one' });
    manager.onEditResult(mkResult('/one.ts', [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+aa'] }]));
    manager.endTurn();
    manager.beginTurn({ promptPreview: 'turn two' });
    manager.onEditResult(mkResult('/two.ts', [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-b', '+bb'] }]));
    expect(manager.recentTurns().map((turn) => turn.turnIndex)).toEqual([2, 1]);
    manager.endTurn();
    expect(manager.recentTurns(1).map((turn) => turn.turnIndex)).toEqual([2]);
  });
});

describe('renderSourceDeltaTurnSummary', () => {
  test('renders cumulative file rows', () => {
    const rows = renderSourceDeltaTurnSummary({
      turnIndex: 1,
      promptPreview: 'fix',
      startedAt: '2026-04-23T00:00:00.000Z',
      stats: {
        filesChanged: 2,
        linesAdded: 5,
        linesRemoved: 3,
        edits: 3,
      },
      files: [
        {
          filePath: '/a.ts',
          hunks: [],
          isNewFile: false,
          linesAdded: 2,
          linesRemoved: 1,
          editCount: 2,
          originalContent: 'a',
          newContent: 'b',
        },
        {
          filePath: '/new.ts',
          hunks: [],
          isNewFile: true,
          linesAdded: 3,
          linesRemoved: 2,
          editCount: 1,
          originalContent: '',
          newContent: 'x',
        },
      ],
    });
    expect(rows[0]).toContain('Source delta');
    expect(rows[1]).toContain('/a.ts');
    expect(rows[1]).toContain('2 edits');
    expect(rows[2]).toContain('Created');
  });
});
