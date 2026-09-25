// PLAN §4.1 · Phase 1.1 — Capture hook bridging into `streamLLMWithTools`.
//
// The hook does three things:
//   1. Classify pending tool calls — only "decision-boundary" calls
//      (Edit / Write / Bash / Agent / git commit) warrant a checkpoint.
//      Cheap calls (Read/Grep/Lsp) skip capture so the cost is bounded.
//   2. Honour `/pause` — when `consumePauseRequest()` returns true the
//      hook writes a `pause` checkpoint and signals the loop to halt
//      gracefully *before* the dispatch.
//   3. Persist a serialisable snapshot of the four core loop states.
//      The snapshot is a flat primitive subset; runtime class instances
//      (DoomLoopTracker etc.) never cross the boundary.

import type { TurnUri } from '../mss/uri/brand.js';
import type { LLMMessage, ContentBlock } from '../llm.js';
import { writeCheckpoint } from './store.js';
import { consumePauseRequest, isPauseRequested } from './pause-flag.js';
import type {
  TurnCheckpoint,
  TurnCheckpointDecision,
  TurnCheckpointLoopSnapshot,
  TurnCheckpointKind,
  TurnCheckpointRecentMessage,
} from './types.js';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);
const SHELL_TOOLS = new Set(['Bash', 'RunShell']);
const AGENT_TOOLS = new Set(['Agent']);

/** True when the pending tool batch contains at least one tool that
 *  warrants a checkpoint. Pure read-side helper — exposed for the
 *  capture hook + tests. */
export function isDecisionBoundary(
  pendingCalls: ReadonlyArray<{ name: string }>,
): boolean {
  for (const call of pendingCalls) {
    if (EDIT_TOOLS.has(call.name)) return true;
    if (SHELL_TOOLS.has(call.name)) return true;
    if (AGENT_TOOLS.has(call.name)) return true;
  }
  return false;
}

function previewArg(args: Record<string, unknown>): string {
  const keys = Object.keys(args);
  if (keys.length === 0) return '';
  const k = keys[0]!;
  const v = args[k];
  let str: string;
  if (typeof v === 'string') str = v;
  else {
    try { str = JSON.stringify(v); } catch { str = String(v); }
  }
  return `${k}=${str.slice(0, 60)}`;
}

function classifyKind(name: string, args: Record<string, unknown>): TurnCheckpointKind {
  if (EDIT_TOOLS.has(name)) return 'edit';
  if (AGENT_TOOLS.has(name)) return 'agent-spawn';
  if (SHELL_TOOLS.has(name)) {
    const cmdField = (args.command ?? args.script ?? args.cmd) as unknown;
    const cmd = typeof cmdField === 'string' ? cmdField.trimStart().toLowerCase() : '';
    if (cmd.startsWith('git commit') || cmd.startsWith('git push')) return 'commit';
    return 'shell';
  }
  return 'shell';
}

function buildDecision(call: { name: string; args: Record<string, unknown> }): TurnCheckpointDecision {
  const kind = classifyKind(call.name, call.args);
  const preview = `${call.name}: ${previewArg(call.args)}`.slice(0, 80);
  return { kind, preview };
}

function flattenContent(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content
    .map((b) => {
      if (b.type === 'text') return b.text;
      if (b.type === 'tool_use') return `[tool_use:${b.name}]`;
      if (b.type === 'tool_result') return `[tool_result]`;
      return '';
    })
    .filter(Boolean)
    .join(' ');
}

function extractRecentText(history: ReadonlyArray<LLMMessage>): string | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (!msg || msg.role !== 'assistant') continue;
    const text = flattenContent(msg.content);
    if (text) return text.slice(-240);
  }
  return undefined;
}

function snapshotRecentMessages(history: ReadonlyArray<LLMMessage>, n = 2): TurnCheckpointRecentMessage[] {
  const tail = history.slice(-n);
  return tail.map((m) => ({
    role: m.role,
    text: flattenContent(m.content).slice(0, 240),
  }));
}

export interface CaptureContext {
  turnUri: TurnUri;
  toolIndex: number;
  history: ReadonlyArray<LLMMessage>;
  loop: TurnCheckpointLoopSnapshot;
  pendingCalls: ReadonlyArray<{ name: string; args: Record<string, unknown> }>;
}

export interface CaptureResult {
  captured: boolean;
  paused: boolean;
}

/** The single entry point `streamLLMWithTools` calls before each round
 *  of tool dispatch. Skips the write cost when neither pause nor a
 *  decision-boundary call is present — the common case for read/grep
 *  turns. */
export function maybeCaptureDecision(ctx: CaptureContext): CaptureResult {
  const pausePeek = isPauseRequested();
  if (!pausePeek && !isDecisionBoundary(ctx.pendingCalls)) {
    return { captured: false, paused: false };
  }

  const firstDecisionCall =
    ctx.pendingCalls.find((c) => EDIT_TOOLS.has(c.name) || SHELL_TOOLS.has(c.name) || AGENT_TOOLS.has(c.name))
    ?? ctx.pendingCalls[0];

  const decision: TurnCheckpointDecision = pausePeek
    ? {
      kind: 'pause',
      preview: firstDecisionCall
        ? `paused before ${firstDecisionCall.name}`
        : 'paused before next dispatch',
    }
    : firstDecisionCall
    ? buildDecision(firstDecisionCall)
    : { kind: 'shell', preview: '(no pending call)' };

  const checkpoint: TurnCheckpoint = {
    turnUri: ctx.turnUri,
    toolIndex: ctx.toolIndex,
    timestamp: new Date().toISOString(),
    decision,
    messageCount: ctx.history.length,
    loop: ctx.loop,
    ...(extractRecentText(ctx.history) !== undefined ? { recentText: extractRecentText(ctx.history)! } : {}),
    recentMessages: snapshotRecentMessages(ctx.history),
  };
  writeCheckpoint(checkpoint);

  if (pausePeek) {
    consumePauseRequest();
    return { captured: true, paused: true };
  }
  return { captured: true, paused: false };
}
