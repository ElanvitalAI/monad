import { describe, expect, test } from 'bun:test';

import {
  acceptReverseHistorySearchResult,
  navigateSingleLineHistory,
  restoreReverseSearchSnapshot,
} from '../src/chat/input-history-state.js';

describe('chat input history state helpers', () => {
  test('navigateSingleLineHistory recalls older entries and preserves the current draft once', () => {
    const history = ['oldest', 'middle', 'latest'];
    const first = navigateSingleLineHistory({
      lines: ['draft'],
      lineIdx: 0,
      colIdx: 5,
      historyIdx: -1,
      savedCurrentInput: '',
    }, history, 'older');

    expect(first).toEqual({
      lines: ['latest'],
      lineIdx: 0,
      colIdx: 6,
      historyIdx: 0,
      savedCurrentInput: 'draft',
    });

    const second = navigateSingleLineHistory(first, history, 'older');
    expect(second).toEqual({
      lines: ['middle'],
      lineIdx: 0,
      colIdx: 6,
      historyIdx: 1,
      savedCurrentInput: 'draft',
    });
  });

  test('navigateSingleLineHistory restores the saved draft when moving newer to -1', () => {
    const history = ['oldest', 'middle', 'latest'];
    expect(navigateSingleLineHistory({
      lines: ['middle'],
      lineIdx: 0,
      colIdx: 6,
      historyIdx: 1,
      savedCurrentInput: 'draft',
    }, history, 'newer')).toEqual({
      lines: ['latest'],
      lineIdx: 0,
      colIdx: 6,
      historyIdx: 0,
      savedCurrentInput: 'draft',
    });

    expect(navigateSingleLineHistory({
      lines: ['latest'],
      lineIdx: 0,
      colIdx: 6,
      historyIdx: 0,
      savedCurrentInput: 'draft',
    }, history, 'newer')).toEqual({
      lines: ['draft'],
      lineIdx: 0,
      colIdx: 5,
      historyIdx: -1,
      savedCurrentInput: 'draft',
    });
  });

  test('restoreReverseSearchSnapshot restores snapshot state when present', () => {
    const fallback = {
      lines: ['current'],
      lineIdx: 0,
      colIdx: 7,
      historyIdx: -1,
      savedCurrentInput: 'current',
    };
    expect(restoreReverseSearchSnapshot({
      lines: ['draft', 'second'],
      lineIdx: 1,
      colIdx: 3,
      historyIdx: 2,
      savedCurrentInput: 'saved',
    }, fallback)).toEqual({
      lines: ['draft', 'second'],
      lineIdx: 1,
      colIdx: 3,
      historyIdx: 2,
      savedCurrentInput: 'saved',
    });
    expect(restoreReverseSearchSnapshot(null, fallback)).toBe(fallback);
  });

  test('acceptReverseHistorySearchResult applies the selected line and resets history navigation', () => {
    expect(acceptReverseHistorySearchResult({
      lines: ['draft'],
      lineIdx: 0,
      colIdx: 5,
      historyIdx: 1,
      savedCurrentInput: 'draft',
    }, 'matched command')).toEqual({
      lines: ['matched command'],
      lineIdx: 0,
      colIdx: 15,
      historyIdx: -1,
      savedCurrentInput: 'matched command',
    });
  });
});
