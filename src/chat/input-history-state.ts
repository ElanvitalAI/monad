import { matchesInputSubstring } from '../input/query-match.js';

export interface TextInputHistoryState {
  lines: string[];
  lineIdx: number;
  colIdx: number;
  historyIdx: number;
  savedCurrentInput: string;
}

export interface ReverseSearchSnapshot {
  lines: string[];
  lineIdx: number;
  colIdx: number;
  historyIdx: number;
  savedCurrentInput: string;
}

export function shouldPreferHistoryArrowNavigation(input: {
  preferHistoryArrowKeys?: boolean;
  linesLength: number;
  historyLength: number;
  historyIdx: number;
  keyName: string;
  currentLine: string;
}): boolean {
  if (input.linesLength !== 1) return false;
  const alreadyNavigatingHistory = input.historyIdx >= 0;
  const shouldBootHistoryFromEmptyDraft =
    input.keyName === 'up' && input.historyLength > 0 && input.currentLine.trim() === '';
  if (!input.preferHistoryArrowKeys
      && !alreadyNavigatingHistory
      && !shouldBootHistoryFromEmptyDraft) {
    return false;
  }
  if (input.keyName === 'up') {
    return input.historyLength > 0 && input.historyIdx < input.historyLength - 1;
  }
  if (input.keyName === 'down') {
    return input.historyIdx >= 0;
  }
  return false;
}

export function shouldSuppressSlashPickerAfterHistoryRecall(input: {
  suppressedByHistoryRecall: boolean;
  linesLength: number;
  currentLine: string;
}): boolean {
  return input.suppressedByHistoryRecall
    && input.linesLength === 1
    && input.currentLine.startsWith('/');
}

export function findReverseHistoryMatchIndices(
  history: readonly string[],
  query: string,
): number[] {
  const matches: number[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const item = history[i] ?? '';
    if (matchesInputSubstring(item, query)) {
      matches.push(i);
    }
  }
  return matches;
}

export function resolveReverseHistorySearchResult(
  history: readonly string[],
  query: string,
  ordinal: number,
): string | null {
  const matches = findReverseHistoryMatchIndices(history, query);
  if (matches.length === 0) return null;
  const clamped = Math.max(0, Math.min(ordinal, matches.length - 1));
  return history[matches[clamped]!] ?? null;
}

export function navigateSingleLineHistory(
  state: TextInputHistoryState,
  history: readonly string[],
  direction: 'older' | 'newer',
): TextInputHistoryState {
  const currentLine = state.lines[0] ?? '';
  const nextHistoryIdx =
    direction === 'older'
      ? state.historyIdx + 1
      : state.historyIdx - 1;
  const nextLine =
    nextHistoryIdx === -1
      ? state.savedCurrentInput
      : (history[history.length - 1 - nextHistoryIdx] ?? currentLine);
  const savedCurrentInput =
    direction === 'older' && state.historyIdx === -1
      ? currentLine
      : state.savedCurrentInput;
  return {
    lines: [nextLine],
    lineIdx: 0,
    colIdx: nextLine.length,
    historyIdx: nextHistoryIdx,
    savedCurrentInput,
  };
}

export function restoreReverseSearchSnapshot(
  snapshot: ReverseSearchSnapshot | null,
  fallback: TextInputHistoryState,
): TextInputHistoryState {
  if (!snapshot) return fallback;
  return {
    lines: [...snapshot.lines],
    lineIdx: snapshot.lineIdx,
    colIdx: snapshot.colIdx,
    historyIdx: snapshot.historyIdx,
    savedCurrentInput: snapshot.savedCurrentInput,
  };
}

export function acceptReverseHistorySearchResult(
  state: TextInputHistoryState,
  match: string | null,
): TextInputHistoryState {
  if (!match) return state;
  return {
    lines: [match],
    lineIdx: 0,
    colIdx: match.length,
    historyIdx: -1,
    savedCurrentInput: match,
  };
}
