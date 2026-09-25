import { describe, expect, test } from 'bun:test';
import {
  buildSourceDeltaBrowserOptions,
  renderSourceDeltaFilePreview,
  renderSourceDeltaTurnPreview,
  type SourceDeltaFile,
  type SourceDeltaTurnSnapshot,
} from '../../src/code-edit/index.js';

function mkFile(overrides: Partial<SourceDeltaFile> = {}): SourceDeltaFile {
  return {
    filePath: '/src/example.ts',
    hunks: [
      {
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 2,
        lines: [' line0', '-old', '+new'],
      },
    ],
    isNewFile: false,
    linesAdded: 1,
    linesRemoved: 1,
    editCount: 1,
    originalContent: 'line0\nold\n',
    newContent: 'line0\nnew\n',
    ...overrides,
  };
}

describe('source-delta browser helpers', () => {
  test('builds file options with delta metadata', () => {
    const turn: SourceDeltaTurnSnapshot = {
      turnIndex: 2,
      promptPreview: 'fix file',
      startedAt: '2026-04-23T00:00:00.000Z',
      stats: { filesChanged: 1, linesAdded: 1, linesRemoved: 1, edits: 1 },
      files: [mkFile()],
    };
    const options = buildSourceDeltaBrowserOptions([turn]);
    expect(options).toHaveLength(2);
    expect(options[0]?.disabled).toBeUndefined();
    expect(options[0]?.icon).toBeTruthy();
    expect(options[0]?.label).toContain('Turn #2');
    expect(options[1]?.label).toBe('/src/example.ts');
    expect(options[1]?.description).toContain('+1 -1');
    expect(options[1]?.description).toContain('edited');
  });

  test('builds grouped options across multiple recent turns', () => {
    const options = buildSourceDeltaBrowserOptions([
      {
        turnIndex: 3,
        promptPreview: 'latest prompt',
        startedAt: '2026-04-23T00:00:00.000Z',
        stats: { filesChanged: 1, linesAdded: 1, linesRemoved: 0, edits: 1 },
        files: [mkFile({ filePath: '/src/latest.ts', linesRemoved: 0 })],
      },
      {
        turnIndex: 2,
        promptPreview: 'older prompt',
        startedAt: '2026-04-22T00:00:00.000Z',
        stats: { filesChanged: 1, linesAdded: 2, linesRemoved: 1, edits: 1 },
        files: [mkFile({ filePath: '/src/older.ts', linesAdded: 2 })],
      },
    ]);
    expect(options).toHaveLength(4);
    expect(options[0]?.label).toContain('Turn #3');
    expect(options[1]?.label).toBe('/src/latest.ts');
    expect(options[2]?.label).toContain('Turn #2');
    expect(options[3]?.label).toBe('/src/older.ts');
  });

  test('builds file-only options with turn metadata', () => {
    const options = buildSourceDeltaBrowserOptions([
      {
        turnIndex: 3,
        promptPreview: 'latest prompt',
        startedAt: '2026-04-23T00:00:00.000Z',
        stats: { filesChanged: 1, linesAdded: 1, linesRemoved: 0, edits: 1 },
        files: [mkFile({ filePath: '/src/latest.ts', linesRemoved: 0 })],
      },
      {
        turnIndex: 2,
        promptPreview: 'older prompt',
        startedAt: '2026-04-22T00:00:00.000Z',
        stats: { filesChanged: 1, linesAdded: 2, linesRemoved: 1, edits: 1 },
        files: [mkFile({ filePath: '/src/older.ts', linesAdded: 2 })],
      },
    ], 'files');
    expect(options).toHaveLength(2);
    expect(options[0]?.label).toBe('/src/latest.ts');
    expect(options[0]?.description).toContain('Turn #3');
    expect(options[0]?.icon).toBeTruthy();
    expect(options[1]?.label).toBe('/src/older.ts');
    expect(options[1]?.description).toContain('Turn #2');
  });

  test('builds turn-only options without file rows', () => {
    const options = buildSourceDeltaBrowserOptions([
      {
        turnIndex: 3,
        promptPreview: 'latest prompt',
        startedAt: '2026-04-23T00:00:00.000Z',
        stats: { filesChanged: 1, linesAdded: 1, linesRemoved: 0, edits: 1 },
        files: [mkFile({ filePath: '/src/latest.ts', linesRemoved: 0 })],
      },
      {
        turnIndex: 2,
        promptPreview: 'older prompt',
        startedAt: '2026-04-22T00:00:00.000Z',
        stats: { filesChanged: 1, linesAdded: 2, linesRemoved: 1, edits: 1 },
        files: [mkFile({ filePath: '/src/older.ts', linesAdded: 2 })],
      },
    ], 'turns');
    expect(options).toHaveLength(2);
    expect(options[0]?.label).toContain('Turn #3');
    expect(options[1]?.label).toContain('Turn #2');
  });

  test('renders turn preview summary for a turn header row', () => {
    const preview = renderSourceDeltaTurnPreview({
      turnIndex: 3,
      promptPreview: 'Refine the renderer split',
      startedAt: '2026-04-23T10:00:00.000Z',
      stats: { filesChanged: 2, linesAdded: 4, linesRemoved: 1, edits: 3 },
      files: [
        mkFile({ filePath: '/src/a.ts', editCount: 2 }),
        mkFile({ filePath: '/src/b.ts', isNewFile: true, linesAdded: 3, linesRemoved: 0 }),
      ],
    });
    expect(preview).toContain('Turn #3');
    expect(preview).toContain('Refine the renderer split');
    expect(preview).toContain('/src/a.ts');
    expect(preview).toContain('/src/b.ts');
  });

  test('renders a Claude-style edited preview and truncates long bodies', () => {
    const preview = renderSourceDeltaFilePreview(mkFile({
      hunks: Array.from({ length: 8 }, (_, idx) => ({
        oldStart: idx + 1,
        oldLines: 1,
        newStart: idx + 1,
        newLines: 1,
        lines: [`-old-${idx}`, `+new-${idx}`],
      })),
      linesAdded: 8,
      linesRemoved: 8,
    }), { cols: 80, maxLines: 6 });
    expect(preview).toContain('Edited');
    expect(preview).toContain('/src/example.ts');
    expect(preview).toContain('… ');
    expect(preview).toContain('more lines');
  });
});
