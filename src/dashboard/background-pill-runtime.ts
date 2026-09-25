// Wave P2 (presentation) · A3-1 — typed background pill chat runtime.
//
// Owns a single chat-surface line that shows the active background
// fleet (shell + agent + workflow). Mirrors the splice pattern used by
// agent-progress-runtime, but the surface is a single line instead of
// a multi-line block.
//
// Wiring: host calls `refresh()` whenever any of the three sources
// changes. shell + agent wire to event subscribers (real-time); workflow
// is polled at refresh time because the runner doesn't expose a
// lifecycle event yet (PLAN follow-up).
//
// Surface-unification v2.2 V2.2-5 (2026-05-11) — `countScheduler` slot
// dropped (scheduler view 폐기 · 동일 데이터는 workflow runs 측이 cover).

import {
  renderBackgroundPill,
  totalRunning,
  type BackgroundPillCounts,
  type BackgroundPillOptions,
} from '../display/background-pill.js';

export interface BackgroundPillRuntimeDeps {
  chatLines: string[];
  pinChatTail: () => void;
  draw: () => void;
  /** Source readers — invoked on every refresh. Implementations
   *  should be cheap (Map size or list-filter), not network calls. */
  countShell: () => number;
  countAgent: () => number;
  countWorkflow: () => number;
  /** Optional theme + attention hooks forwarded to renderBackgroundPill. */
  options?: () => BackgroundPillOptions;
}

export interface BackgroundPillRuntime {
  /** Recompute counts and update the chat block. Idempotent — no
   *  redraw if the rendered line is unchanged. */
  refresh: () => void;
  /** Drop the pill from chatLines (e.g. session reset). */
  reset: () => void;
  /** Wave C — current absolute index of the pill row inside
   *  chatLines, or null when no pill is rendered. Mouse routing uses
   *  this to map a chat-area click row to the pill. */
  getPillRow: () => number | null;
  /** Test seam — current rendered line, or null when absent. */
  _lineForTest: () => string | null;
}

interface BlockHandle {
  start: number;
}

export function createBackgroundPillRuntime(
  deps: BackgroundPillRuntimeDeps,
): BackgroundPillRuntime {
  let block: BlockHandle | null = null;
  let lastLine: string | null = null;

  const resolveBlockStart = (): number | null => {
    if (!block || lastLine === null) return null;
    if (deps.chatLines[block.start] === lastLine) return block.start;
    for (let index = deps.chatLines.length - 1; index >= 0; index--) {
      if (deps.chatLines[index] === lastLine) return index;
    }
    return null;
  };

  const removeBlock = (): void => {
    const start = resolveBlockStart();
    if (start !== null) deps.chatLines.splice(start, 1);
    block = null;
    lastLine = null;
  };

  const writeLine = (line: string): void => {
    const start = resolveBlockStart();
    if (start === null) {
      const appendedStart = deps.chatLines.length;
      deps.chatLines.push(line);
      block = { start: appendedStart };
    } else {
      deps.chatLines.splice(start, 1, line);
      block = { start };
    }
    lastLine = line;
  };

  const refresh = (): void => {
    const counts: BackgroundPillCounts = {
      shell: Math.max(0, deps.countShell()),
      agent: Math.max(0, deps.countAgent()),
      workflow: Math.max(0, deps.countWorkflow()),
    };
    if (totalRunning(counts) === 0) {
      if (block) {
        removeBlock();
        deps.pinChatTail();
        deps.draw();
      }
      return;
    }
    const opts = deps.options?.() ?? {};
    const line = renderBackgroundPill(counts, opts);
    if (line === null) {
      if (block) {
        removeBlock();
        deps.pinChatTail();
        deps.draw();
      }
      return;
    }
    if (line === lastLine && block) {
      const start = resolveBlockStart();
      if (start !== null) {
        block = { start };
        return;
      }
    }
    writeLine(line);
    deps.pinChatTail();
    deps.draw();
  };

  return {
    refresh,
    reset() {
      if (block) {
        removeBlock();
        deps.pinChatTail();
        deps.draw();
      }
    },
    getPillRow: () => {
      const start = resolveBlockStart();
      if (start === null) {
        block = null;
        lastLine = null;
        return null;
      }
      block = { start };
      return start;
    },
    _lineForTest: () => lastLine,
  };
}
