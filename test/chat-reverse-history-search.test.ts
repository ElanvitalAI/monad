import { describe, expect, test } from 'bun:test';

import {
  acceptReverseHistorySearch,
  applyReverseHistorySearchKey,
  cancelReverseHistorySearch,
  inactiveReverseHistorySearchState,
  resolveCurrentReverseHistorySearchResult,
  startOrCycleReverseHistorySearch,
} from '../src/chat/reverse-history-search.js';

describe('chat reverse history search controller', () => {
  const history = [
    'first command',
    'second question',
    '/run-skill ast-grep',
    'latest question about agents',
  ];

  test('startOrCycleReverseHistorySearch captures a snapshot and cycles newest-first matches', () => {
    const started = startOrCycleReverseHistorySearch(
      inactiveReverseHistorySearchState(),
      history,
      {
        lines: ['draft'],
        lineIdx: 0,
        colIdx: 5,
        historyIdx: -1,
        savedCurrentInput: 'draft',
      },
    );

    expect(started).toEqual({
      active: true,
      query: '',
      ordinal: 0,
      snapshot: {
        lines: ['draft'],
        lineIdx: 0,
        colIdx: 5,
        historyIdx: -1,
        savedCurrentInput: 'draft',
      },
    });

    const refined = applyReverseHistorySearchKey(started, { name: 'q', ctrl: false, alt: false, shift: false });
    const cycled = startOrCycleReverseHistorySearch(refined.search, history, {
      lines: ['ignored'],
      lineIdx: 0,
      colIdx: 0,
      historyIdx: 0,
      savedCurrentInput: '',
    });
    expect(resolveCurrentReverseHistorySearchResult(cycled, history)).toBe('second question');
  });

  test('applyReverseHistorySearchKey appends query text and reports cancel-and-fallthrough for unrelated keys', () => {
    const active = {
      active: true,
      query: 'que',
      ordinal: 2,
      snapshot: {
        lines: ['draft'],
        lineIdx: 0,
        colIdx: 5,
        historyIdx: -1,
        savedCurrentInput: 'draft',
      },
    };

    expect(applyReverseHistorySearchKey(active, {
      name: 's',
      ctrl: false,
      alt: false,
      shift: false,
    })).toEqual({
      action: 'continue',
      search: {
        ...active,
        query: 'ques',
        ordinal: 0,
      },
    });

    expect(applyReverseHistorySearchKey(active, {
      name: 'left',
      ctrl: false,
      alt: false,
      shift: false,
    })).toEqual({
      action: 'cancel-and-fallthrough',
      search: inactiveReverseHistorySearchState(),
    });
  });

  test('cancel and accept return the expected input state transitions', () => {
    const active = {
      active: true,
      query: 'question',
      ordinal: 0,
      snapshot: {
        lines: ['draft'],
        lineIdx: 0,
        colIdx: 5,
        historyIdx: -1,
        savedCurrentInput: 'draft',
      },
    };

    expect(cancelReverseHistorySearch(active, {
      lines: ['mutated'],
      lineIdx: 0,
      colIdx: 7,
      historyIdx: 1,
      savedCurrentInput: 'mutated',
    })).toEqual({
      search: inactiveReverseHistorySearchState(),
      input: {
        lines: ['draft'],
        lineIdx: 0,
        colIdx: 5,
        historyIdx: -1,
        savedCurrentInput: 'draft',
      },
    });

    expect(acceptReverseHistorySearch(active, history, {
      lines: ['draft'],
      lineIdx: 0,
      colIdx: 5,
      historyIdx: -1,
      savedCurrentInput: 'draft',
    })).toEqual({
      accepted: true,
      search: inactiveReverseHistorySearchState(),
      input: {
        lines: ['latest question about agents'],
        lineIdx: 0,
        colIdx: 28,
        historyIdx: -1,
        savedCurrentInput: 'latest question about agents',
      },
    });
  });
});
