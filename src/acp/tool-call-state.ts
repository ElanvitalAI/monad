// ACP H1 #3 — Tool call state machine.
//
// Per-session table of tool-call lifecycle records. Extends the ACP
// wire `ToolCallStatus` (4 states · pending / in_progress / completed /
// failed) with three client-side states that cover elanous's HITL
// approval flow + turn cancellation:
//
//   waiting_for_confirmation  — HITL race in flight (Telegram/Discord/
//                               terminal modal). Ends on approver
//                               result → in_progress (approved) or
//                               rejected (denied).
//   rejected                  — user said no.
//   canceled                  — turn was canceled mid-execution
//                               (e.g. /acp cancel).
//
// Reference · Zed `acp_thread.rs` L568-617 `ToolCallStatus` — same 7
// states, same semantics. We mirror the client-side extension because
// the protocol doesn't carry these (the subprocess only sends the 4
// wire states; HITL waiting + rejection + cancel are client-side).
//
// Reference · Warp block-based output + status badges (docs.warp.dev)
// — rendering glyph per state lives in `toolCallGlyph` below.

import type { ToolCall, ToolCallUpdate } from '@agentclientprotocol/sdk';
import { debug } from '../debug/log.js';

export type ToolCallState =
  | 'pending'
  | 'waiting_for_confirmation'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'rejected'
  | 'canceled';

export const TERMINAL_STATES: readonly ToolCallState[] = [
  'completed',
  'failed',
  'rejected',
  'canceled',
];

export interface ToolCallRecord {
  id: string;
  title: string;
  kind?: string;
  state: ToolCallState;
  startedAt: number;
  endedAt?: number;
  error?: string;
  rawInput?: unknown;
  rawOutput?: unknown;
}

export interface ToolCallTable {
  createFromWire(tc: ToolCall): ToolCallRecord;
  applyUpdate(upd: ToolCallUpdate): ToolCallRecord | null;
  markWaitingForConfirmation(id: string): ToolCallRecord | null;
  markRejected(id: string): ToolCallRecord | null;
  markCanceledAll(): ToolCallRecord[];
  get(id: string): ToolCallRecord | null;
  list(): ToolCallRecord[];
  clear(): void;
  canTransition(from: ToolCallState, to: ToolCallState): boolean;
}

interface Opts {
  now?: () => number;
}

// from → set of legal `to` states.
const TRANSITIONS: Record<ToolCallState, ReadonlySet<ToolCallState>> = {
  pending: new Set<ToolCallState>([
    'waiting_for_confirmation',
    'in_progress',
    'completed', // some agents skip straight to completion (zero-duration tool)
    'failed',
    'canceled',
  ]),
  waiting_for_confirmation: new Set<ToolCallState>([
    'in_progress',
    'rejected',
    'canceled',
    'failed',
  ]),
  in_progress: new Set<ToolCallState>([
    'completed',
    'failed',
    'canceled',
  ]),
  completed: new Set<ToolCallState>(),
  failed: new Set<ToolCallState>(),
  rejected: new Set<ToolCallState>(),
  canceled: new Set<ToolCallState>(),
};

function isTerminal(state: ToolCallState): boolean {
  return TERMINAL_STATES.includes(state);
}

function wireStateToClient(status: ToolCall['status'] | null | undefined): ToolCallState {
  // Wire status undefined/null/missing → treat as 'pending' per ACP default.
  switch (status) {
    case 'pending':
    case undefined:
    case null:
      return 'pending';
    case 'in_progress':
      return 'in_progress';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    default:
      return 'pending';
  }
}

export function createToolCallTable(opts: Opts = {}): ToolCallTable {
  const now = opts.now ?? (() => Date.now());
  const table = new Map<string, ToolCallRecord>();

  const transition = (rec: ToolCallRecord, to: ToolCallState, endIfTerminal = true): boolean => {
    if (rec.state === to) return false;
    const legal = TRANSITIONS[rec.state].has(to);
    if (!legal) {
      if (debug.enabled) {
        debug.log('acp.toolcall.illegal', `${rec.id}: ${rec.state}→${to}`, {
          id: rec.id,
          from: rec.state,
          to,
        });
      }
      return false;
    }
    const prev = rec.state;
    rec.state = to;
    if (endIfTerminal && isTerminal(to)) rec.endedAt = now();
    if (debug.enabled) {
      debug.log('acp.toolcall.transition', `${rec.id}: ${prev}→${to}`, {
        id: rec.id,
        from: prev,
        to,
      });
    }
    return true;
  };

  return {
    createFromWire(tc) {
      const state = wireStateToClient(tc.status);
      const rec: ToolCallRecord = {
        id: tc.toolCallId,
        title: tc.title,
        state,
        startedAt: now(),
      };
      if (typeof tc.kind === 'string') rec.kind = tc.kind;
      if (tc.rawInput !== undefined) rec.rawInput = tc.rawInput;
      if (tc.rawOutput !== undefined) rec.rawOutput = tc.rawOutput;
      if (isTerminal(state)) rec.endedAt = rec.startedAt;
      table.set(rec.id, rec);
      if (debug.enabled) {
        debug.log('acp.toolcall.create', `${rec.id}:${state}`, {
          id: rec.id,
          title: rec.title,
          state,
        });
      }
      return rec;
    },
    applyUpdate(upd) {
      const rec = table.get(upd.toolCallId);
      if (!rec) {
        if (debug.enabled) debug.log('acp.toolcall.unknown-id', upd.toolCallId);
        return null;
      }
      if (typeof upd.title === 'string') rec.title = upd.title;
      if (typeof upd.kind === 'string') rec.kind = upd.kind;
      if (upd.rawInput !== undefined) rec.rawInput = upd.rawInput;
      if (upd.rawOutput !== undefined) rec.rawOutput = upd.rawOutput;
      if (upd.status !== undefined) {
        const next = wireStateToClient(upd.status);
        transition(rec, next);
      }
      return rec;
    },
    markWaitingForConfirmation(id) {
      const rec = table.get(id);
      if (!rec) return null;
      return transition(rec, 'waiting_for_confirmation') ? rec : null;
    },
    markRejected(id) {
      const rec = table.get(id);
      if (!rec) return null;
      return transition(rec, 'rejected') ? rec : null;
    },
    markCanceledAll() {
      const flipped: ToolCallRecord[] = [];
      for (const rec of table.values()) {
        if (!isTerminal(rec.state) && transition(rec, 'canceled')) {
          flipped.push(rec);
        }
      }
      return flipped;
    },
    get(id) {
      return table.get(id) ?? null;
    },
    list() {
      return Array.from(table.values());
    },
    clear() {
      table.clear();
      if (debug.enabled) debug.log('acp.toolcall.clear', '');
    },
    canTransition(from, to) {
      return from === to ? false : TRANSITIONS[from].has(to);
    },
  };
}

export function toolCallGlyph(state: ToolCallState): string {
  switch (state) {
    case 'pending': return '⋯';
    case 'waiting_for_confirmation': return '?';
    case 'in_progress': return '⟳';
    case 'completed': return '✓';
    case 'failed': return '✗';
    case 'rejected': return '✕';
    case 'canceled': return '⊘';
  }
}

export function toolCallLabel(state: ToolCallState): string {
  switch (state) {
    case 'pending': return 'Pending';
    case 'waiting_for_confirmation': return 'Waiting for confirmation';
    case 'in_progress': return 'In progress';
    case 'completed': return 'Completed';
    case 'failed': return 'Failed';
    case 'rejected': return 'Rejected';
    case 'canceled': return 'Canceled';
  }
}
