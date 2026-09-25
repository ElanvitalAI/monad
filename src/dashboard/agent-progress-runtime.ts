// Wave P2 (presentation) · A1-1 — agent progress chat block runtime.
//
// Owns a single chat-surface block that mirrors the active sub-agent
// fleet. Subscribes to `agent:update` events from the existing roster
// runtime; on each update it rebuilds the block snapshot via
// `renderAgentProgressBlock` and splices it into chatLines in place
// (push-then-replace pattern, parallel to rendered-tool-runtime).
//
// Why a separate runtime instead of reusing rendered-tool-runtime:
// rendered-tool-runtime is created per turn-stream (turn-scoped) and
// keys off tool callIds. The agent progress block is host-scoped (one
// block across the lifetime of a fleet, may span multiple turns) and
// keys off the agent fleet, not a single tool call. Splicing rules
// are identical so the implementation mirrors the same shift-static
// pattern.

import type { DashboardAgentUpdateEvent } from './agent-roster-runtime.js';
import {
  formatAgentElapsed,
  renderAgentProgressBlock,
  type AgentProgressEntry,
} from '../display/agent-progress-line.js';

export interface AgentProgressRuntimeDeps {
  chatLines: string[];
  pinChatTail: () => void;
  draw: () => void;
  /** Optional theme color hooks forwarded to renderAgentProgressBlock. */
  colors?: Parameters<typeof renderAgentProgressBlock>[1] extends infer O
    ? O extends { colors?: infer C } ? C : never
    : never;
  /** Cap visible agents — defaults to renderAgentProgressBlock default (3). */
  maxDisplay?: number;
}

export interface AgentProgressRuntime {
  onAgentUpdate: (event: DashboardAgentUpdateEvent) => void;
  /** Drop the block from chatLines and forget all entries. Used on
   *  session reset or when the operator explicitly clears chat. */
  reset: () => void;
  /** Test seam — current entry snapshot. */
  _entriesForTest: () => ReadonlyArray<AgentProgressEntry>;
}

interface BlockHandle {
  start: number;
  lines: string[];
}

export function createAgentProgressRuntime(
  deps: AgentProgressRuntimeDeps,
): AgentProgressRuntime {
  const entries = new Map<string, AgentProgressEntry>();
  const previousStatuses = new Map<string, AgentProgressEntry['status']>();
  const notifiedTerminalIds = new Set<string>();
  const backgroundIds = new Set<string>();
  let block: BlockHandle | null = null;

  const eventToEntry = (event: DashboardAgentUpdateEvent): AgentProgressEntry | null => {
    if (event.status === 'removed') return null;
    if (!event.payload) return null;
    return {
      id: event.id,
      name: event.payload.name || event.payload.definitionName,
      status: event.status,
      toolCount: event.payload.toolCount,
      elapsedMs: event.payload.elapsedMs,
      ...((event.status === 'running' || event.status === 'queued')
        ? (event.payload.currentTool ? { lastToolText: event.payload.currentTool } : {})
        : (event.payload.summary || event.payload.error
          ? { lastToolText: event.payload.summary || event.payload.error }
          : {})),
    };
  };

  const renderLines = (): string[] => {
    if (entries.size === 0) return [];
    const priority = { error: 0, running: 1, queued: 2, cancelled: 3, done: 4 } as const;
    const ordered = [...entries.values()].sort((a, b) => priority[a.status] - priority[b.status]);
    return renderAgentProgressBlock(ordered, {
      ...(deps.maxDisplay !== undefined ? { maxDisplay: deps.maxDisplay } : {}),
      ...(deps.colors ? { colors: deps.colors } : {}),
    });
  };

  const resolveBlockStart = (): number | null => {
    if (!block) return null;
    const { start, lines } = block;
    const matchesAt = (index: number): boolean =>
      lines.every((line, offset) => deps.chatLines[index + offset] === line);
    if (start >= 0 && start + lines.length <= deps.chatLines.length && matchesAt(start)) return start;
    for (let index = deps.chatLines.length - lines.length; index >= 0; index--) {
      if (matchesAt(index)) return index;
    }
    return null;
  };

  const removeBlock = (): void => {
    const start = resolveBlockStart();
    if (start !== null && block) deps.chatLines.splice(start, block.lines.length);
    block = null;
  };

  const writeBlock = (lines: string[]): void => {
    if (lines.length === 0) {
      removeBlock();
      return;
    }
    const start = resolveBlockStart();
    if (start === null) {
      const appendedStart = deps.chatLines.length;
      deps.chatLines.push(...lines);
      block = { start: appendedStart, lines: [...lines] };
      return;
    }
    deps.chatLines.splice(start, block!.lines.length, ...lines);
    block = { start, lines: [...lines] };
  };

  const flush = (): void => {
    const lines = renderLines();
    writeBlock(lines);
    deps.pinChatTail();
    deps.draw();
  };

  const terminalNotification = (
    event: DashboardAgentUpdateEvent,
    previousStatus: AgentProgressEntry['status'] | undefined,
  ): string | undefined => {
    const payload = event.payload;
    if (!payload || (!(payload.background || backgroundIds.has(event.id)) || notifiedTerminalIds.has(event.id))) return undefined;
    if (previousStatus !== 'running' && previousStatus !== 'queued') return undefined;
    if (event.status === 'done') {
      return `  ✓ ${payload.name || payload.definitionName} 끝남 · ${formatAgentElapsed(payload.elapsedMs)} — 결과는 다음 턴에 이어집니다`;
    }
    if (event.status === 'error') {
      const firstErrorLine = (payload.error ?? '').split(/\r?\n/, 1)[0]!.slice(0, 60);
      return `  ✗ ${payload.name || payload.definitionName} 실패 · ${firstErrorLine}`;
    }
    if (event.status === 'cancelled') return `  ⏹ ${payload.name || payload.definitionName} 중단됨`;
    return undefined;
  };

  return {
    onAgentUpdate(event) {
      if (event.status === 'removed') {
        previousStatuses.delete(event.id);
        notifiedTerminalIds.delete(event.id);
        backgroundIds.delete(event.id);
        if (entries.delete(event.id)) flush();
        return;
      }
      if (event.payload?.background === true) backgroundIds.add(event.id);
      const entry = eventToEntry(event);
      if (!entry) return;
      const notification = terminalNotification(event, previousStatuses.get(event.id));
      entries.set(event.id, entry);
      previousStatuses.set(event.id, entry.status);
      flush();
      if (notification) {
        notifiedTerminalIds.add(event.id);
        deps.chatLines.push(notification);
        deps.pinChatTail();
        deps.draw();
      }
    },
    reset() {
      entries.clear();
      previousStatuses.clear();
      notifiedTerminalIds.clear();
      backgroundIds.clear();
      removeBlock();
      deps.pinChatTail();
      deps.draw();
    },
    _entriesForTest: () => [...entries.values()],
  };
}
