// ── PTY chat-log activity formatter (V2) ──
//
// Renders chat-pane entries for PtyShell* tool calls so the user sees
// what the LLM spawned/wrote/killed without opening /pty-list. Mirrors
// codex-rs's UnifiedExecProcessesCell (history_cell.rs:660-750): every
// PTY interaction leaves a short, ⚡-prefixed audit line in the scroll
// buffer.
//
// Pure-render — no process state, no IO. Caller (dashboard chat loop)
// feeds in { name, args } pre-call and { name, result } post-call.
// Returns null for non-PTY tools so the caller can fall through to its
// generic `tool: name(...)` formatting.

import { C } from './tui.js';

/** Tools we render specialized activity lines for. */
const PTY_TOOL_NAMES: ReadonlySet<string> = new Set([
  'PtyShellStart', 'PtyShellPoll', 'PtyShellSend', 'PtyShellKill', 'PtyShellList',
]);

const PREFIX = '⚡';
const CMD_TRUNC = 60;
const INPUT_TRUNC = 30;

export function isPtyTool(name: string): boolean {
  return PTY_TOOL_NAMES.has(name);
}

/** Truncate with … suffix once over cap. */
function clip(s: string, cap: number): string {
  if (s.length <= cap) return s;
  return s.slice(0, cap - 1) + '…';
}

/** Escape whitespace in a user-provided input string so the log line
 *  stays on one row even if the LLM sent "\n" or a tab. */
function escapeInput(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\r/g, '\\r');
}

function argString(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === 'string' ? v : undefined;
}

/** Pre-call line. Returns null when name is not a PtyShell tool so the
 *  dashboard can fall back to its generic `brain tool:` rendering. */
export function formatPtyCallLine(name: string, args: Record<string, unknown>): string | null {
  if (!isPtyTool(name)) return null;

  switch (name) {
    case 'PtyShellStart': {
      const cmd = argString(args, 'cmd') ?? '(no cmd)';
      const detach = args.detach === true ? ' [detach]' : '';
      return C.accent(`${PREFIX} spawn "${clip(cmd, CMD_TRUNC)}"${detach}`);
    }
    case 'PtyShellPoll': {
      const id = argString(args, 'process_id') ?? '?';
      return C.muted(`${PREFIX} poll ${id}`);
    }
    case 'PtyShellSend': {
      const id = argString(args, 'process_id') ?? '?';
      const input = argString(args, 'input') ?? '';
      return C.accent(`${PREFIX} write ${id} "${clip(escapeInput(input), INPUT_TRUNC)}"`);
    }
    case 'PtyShellKill': {
      const id = argString(args, 'process_id') ?? '?';
      const sig = argString(args, 'signal');
      return C.warning(`${PREFIX} kill ${id}${sig ? ` (${sig})` : ''}`);
    }
    case 'PtyShellList':
      return C.muted(`${PREFIX} list`);
    default:
      return null;
  }
}

/** Parse the leading header line of a PtyShell* dispatch result.
 *  Dispatchers format as:
 *    "PtyShellStart process_id=pty_xxx status=... bytes=N\n<body>"
 *    "PtyShellKill  process_id=pty_xxx killed=true exit=0\n<body>"
 *  Returns a dict of key=value pairs from the first line. */
function parseHeader(output: string): Record<string, string> {
  const firstLine = output.split('\n', 1)[0] ?? '';
  const out: Record<string, string> = {};
  // Tokens are space-separated `key=value` after the tool name.
  for (const tok of firstLine.split(/\s+/).slice(1)) {
    const eq = tok.indexOf('=');
    if (eq > 0) out[tok.slice(0, eq)] = tok.slice(eq + 1);
  }
  return out;
}

function headerValue(hdr: Record<string, string>, key: string): string {
  const value = hdr[key];
  return value === undefined || value.trim() === '' ? '?' : value;
}

function hasHeaderValue(hdr: Record<string, string>, key: string): boolean {
  const value = hdr[key];
  return value !== undefined && value.trim() !== '';
}

function incompleteHeader(hdr: Record<string, string>, keys: readonly string[]): string {
  return keys.some((key) => !hasHeaderValue(hdr, key)) ? ' · incomplete header' : '';
}

/** Post-call line. Returns null for non-PTY tools or when the result
 *  shape is unexpected (e.g. error object) — the error will surface in
 *  the model's next turn; we don't duplicate it in the audit log. */
export function formatPtyResultLine(name: string, result: unknown): string | null {
  if (!isPtyTool(name)) return null;
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  // Skip error payloads; the generic tool-result path surfaces them.
  if (typeof r.error === 'string') return null;
  const output = typeof r.output === 'string' ? r.output : '';
  if (!output) return null;

  const hdr = parseHeader(output);

  switch (name) {
    case 'PtyShellStart': {
      const id = headerValue(hdr, 'process_id');
      const status = headerValue(hdr, 'status');
      const incomplete = incompleteHeader(hdr, ['process_id', 'status']);
      return C.muted(`  ↳ spawned ${id} (${status})${incomplete}`);
    }
    case 'PtyShellPoll': {
      const id = headerValue(hdr, 'process_id');
      const bytes = headerValue(hdr, 'bytes');
      const status = headerValue(hdr, 'status');
      const incomplete = incompleteHeader(hdr, ['process_id', 'bytes', 'status']);
      return C.muted(`  ↳ ${bytes}B from ${id} (${status})${incomplete}`);
    }
    case 'PtyShellSend': {
      const id = headerValue(hdr, 'process_id');
      const bytes = headerValue(hdr, 'bytes');
      const status = headerValue(hdr, 'status');
      const incomplete = incompleteHeader(hdr, ['process_id', 'bytes', 'status']);
      return C.muted(`  ↳ wrote to ${id} · ${bytes}B reply (${status})${incomplete}`);
    }
    case 'PtyShellKill': {
      const id = headerValue(hdr, 'process_id');
      const exit = headerValue(hdr, 'exit');
      const killed = hasHeaderValue(hdr, 'killed') ? hdr.killed === 'true' : undefined;
      const verb = killed === undefined ? '?' : killed ? 'killed' : 'already-exited';
      const incomplete = incompleteHeader(hdr, ['process_id', 'killed', 'exit']);
      return C.muted(`  ↳ ${verb} ${id} (exit ${exit})${incomplete}`);
    }
    case 'PtyShellList':
      return null; // List already prints one line per process in output.
    default:
      return null;
  }
}
