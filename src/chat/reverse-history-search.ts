import type { Key } from '../tui.js';
import { backspaceInputText, textFromInputKey } from '../input/text-key.js';
import {
  acceptReverseHistorySearchResult,
  findReverseHistoryMatchIndices,
  resolveReverseHistorySearchResult,
  restoreReverseSearchSnapshot,
  type ReverseSearchSnapshot,
  type TextInputHistoryState,
} from './input-history-state.js';

export interface ReverseHistorySearchState {
  active: boolean;
  query: string;
  ordinal: number;
  snapshot: ReverseSearchSnapshot | null;
}

export type ReverseHistorySearchKeyAction =
  | 'accept'
  | 'cancel'
  | 'cancel-and-fallthrough'
  | 'continue';

export function inactiveReverseHistorySearchState(): ReverseHistorySearchState {
  return {
    active: false,
    query: '',
    ordinal: 0,
    snapshot: null,
  };
}

export function resolveCurrentReverseHistorySearchResult(
  state: ReverseHistorySearchState,
  history: readonly string[],
): string | null {
  return resolveReverseHistorySearchResult(history, state.query, state.ordinal);
}

export function startOrCycleReverseHistorySearch(
  state: ReverseHistorySearchState,
  history: readonly string[],
  snapshot: ReverseSearchSnapshot,
): ReverseHistorySearchState {
  if (history.length === 0) return state;
  if (!state.active) {
    return {
      active: true,
      query: '',
      ordinal: 0,
      snapshot,
    };
  }
  const matches = findReverseHistoryMatchIndices(history, state.query);
  if (matches.length === 0) return state;
  return {
    ...state,
    ordinal: Math.min(state.ordinal + 1, matches.length - 1),
  };
}

export function cancelReverseHistorySearch(
  state: ReverseHistorySearchState,
  fallback: TextInputHistoryState,
): { search: ReverseHistorySearchState; input: TextInputHistoryState } {
  return {
    search: inactiveReverseHistorySearchState(),
    input: restoreReverseSearchSnapshot(state.snapshot, fallback),
  };
}

export function acceptReverseHistorySearch(
  state: ReverseHistorySearchState,
  history: readonly string[],
  input: TextInputHistoryState,
): { accepted: boolean; search: ReverseHistorySearchState; input: TextInputHistoryState } {
  const match = resolveCurrentReverseHistorySearchResult(state, history);
  if (!match) {
    return {
      accepted: false,
      search: state,
      input,
    };
  }
  return {
    accepted: true,
    search: inactiveReverseHistorySearchState(),
    input: acceptReverseHistorySearchResult(input, match),
  };
}

export function applyReverseHistorySearchKey(
  state: ReverseHistorySearchState,
  key: Pick<Key, 'name' | 'ctrl' | 'alt' | 'shift'>,
): { search: ReverseHistorySearchState; action: ReverseHistorySearchKeyAction } {
  if (!state.active) {
    return { search: state, action: 'continue' };
  }
  if (key.name === 'escape') {
    return { search: inactiveReverseHistorySearchState(), action: 'cancel' };
  }
  if (key.name === 'enter' && !key.shift) {
    return { search: state, action: 'accept' };
  }
  if (key.name === 'backspace') {
    if (state.query.length === 0) {
      return { search: state, action: 'continue' };
    }
    return {
      search: {
        ...state,
        query: backspaceInputText(state.query),
        ordinal: 0,
      },
      action: 'continue',
    };
  }
  const typed = textFromInputKey(key, { allowSpace: true });
  if (typed !== null) {
    return {
      search: {
        ...state,
        query: state.query + typed,
        ordinal: 0,
      },
      action: 'continue',
    };
  }
  return {
    search: inactiveReverseHistorySearchState(),
    action: 'cancel-and-fallthrough',
  };
}
