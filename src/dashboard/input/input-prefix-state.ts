import type { DashboardInputEntryMode } from './entry-mode.js';
import { buildDashboardInputInitialText } from './entry-mode.js';

export interface DashboardInputPrefixState {
  get(): string;
  set(next: string): void;
  appendInline(text: string): void;
  appendBlock(text: string): void;
  consumeInitialText(mode: DashboardInputEntryMode): string | undefined;
}

export function createDashboardInputPrefixState(): DashboardInputPrefixState {
  let pendingPrefix = '';

  return {
    get: () => pendingPrefix,
    set: (next) => { pendingPrefix = next; },
    appendInline: (text) => {
      pendingPrefix = (pendingPrefix ? `${pendingPrefix} ` : '') + text;
    },
    appendBlock: (text) => {
      pendingPrefix = (pendingPrefix ? `${pendingPrefix}\n` : '') + text;
    },
    consumeInitialText: (mode) => {
      const next = buildDashboardInputInitialText(mode, pendingPrefix);
      pendingPrefix = '';
      return next;
    },
  };
}
