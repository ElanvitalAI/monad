// ── Agent log adapter ──
//
// Phase F2 — translate AgentEvent streams from N parallel agents into
// a single attributed log. Each emitted line carries an [agent-name]
// prefix in the agent's deterministic color so a reader can separate
// interleaved streams at a glance.
//
// Buffering rule for text deltas: a delta may arrive mid-sentence
// (e.g. "bull" then "ish"). We append to a per-agent buffer and only
// emit a line when a `\n` appears OR when a non-text event arrives
// (forces a flush). This keeps tool_call / status boundaries on their
// own lines without clipping streamed text.
//
// HUD-friendly metrics (active count, total tokens emitted) live on
// the adapter so the log pane overlay (Phase F4 wiring) can render
// `⟳ 3/5 agents running` without walking the registry.

import type { AgentEvent } from './types.js';
import { agentColor, agentColorNoop } from './color-map.js';

// ── Types ──

export interface LogAdapterOpts {
  /** Override color selection (tests pass agentColorNoop for ANSI-free
   *  assertions). Defaults to the hash-based agentColor palette. */
  color?: (name: string) => (s: string) => string;
  /** Prefix prepended before the `[agent]` tag on every line — lets a
   *  caller namespace the log, e.g. "  consensus · [margaret] …". */
  linePrefix?: string;
  /** Dim helper applied to status lines. Defaults to identity so
   *  tests see the raw text; the dashboard overrides with a dim
   *  chalk wrapper. */
  dim?: (s: string) => string;
}

/** A single thread marker emitted alongside a line — used by the log
 *  pane's Phase F3 folding to group consecutive lines from the same
 *  agent into collapsible blocks. */
export interface LogLineMeta {
  agent: string;
  kind: 'text' | 'tool_call' | 'tool_result' | 'status';
  /** True when this line opens a new thread (previous emitted line
   *  belonged to a different agent or this is the first line). */
  threadStart: boolean;
  /** True when the agent emitted a terminal status on this line
   *  (done / error / aborted). Lets the folder mark the thread
   *  as closed so it can be collapsed into a single summary line. */
  threadEnd: boolean;
}

export interface EmittedLine {
  text: string;
  meta: LogLineMeta;
}

// ── Adapter ──

export class AgentLogAdapter {
  private textBuffer = new Map<string, string>();
  private lastAgent: string | null = null;
  private terminatedAgents = new Set<string>();
  private opts: Required<LogAdapterOpts>;

  constructor(opts: LogAdapterOpts = {}) {
    this.opts = {
      color: opts.color ?? agentColor,
      linePrefix: opts.linePrefix ?? '',
      dim: opts.dim ?? ((s: string) => s),
    };
  }

  /** Feed one event. Returns zero or more lines ready for the log. */
  ingest(agentName: string, event: AgentEvent): EmittedLine[] {
    const out: EmittedLine[] = [];

    // Any non-text event flushes buffered text first so boundaries
    // land on their own lines.
    if (event.type !== 'text') {
      const pending = this.flushBuffer(agentName);
      if (pending !== null) {
        out.push(this.line(agentName, 'text', pending));
      }
    }

    switch (event.type) {
      case 'text': {
        const buf = (this.textBuffer.get(agentName) ?? '') + event.delta;
        // Emit every complete line (newline-terminated), keep the trailing
        // partial in the buffer.
        const parts = buf.split('\n');
        const tail = parts.pop() ?? '';
        for (const p of parts) {
          out.push(this.line(agentName, 'text', p));
        }
        this.textBuffer.set(agentName, tail);
        break;
      }
      case 'tool_call': {
        const args = stringifyArgsCompact(event.args);
        out.push(this.line(agentName, 'tool_call', `➜ ${event.name}(${args})`));
        break;
      }
      case 'tool_result': {
        const result = stringifyResultCompact(event.result);
        out.push(this.line(agentName, 'tool_result', `← ${event.name} → ${result}`));
        break;
      }
      case 'status': {
        // Terminal stages (done/error/aborted) must update the marker
        // set BEFORE line() so threadEnd reflects the transition.
        if (event.stage === 'done' || event.stage === 'error' || event.stage === 'aborted') {
          this.terminatedAgents.add(agentName);
        }
        out.push(this.line(agentName, 'status', `· ${event.stage}`));
        break;
      }
      case 'done': {
        // `done` carries the full text too; ignore here since we've
        // streamed it line-by-line already. The terminal status was
        // emitted by the preceding status:done.
        break;
      }
      case 'error': {
        this.terminatedAgents.add(agentName);
        out.push(this.line(agentName, 'status', `· error: ${event.message}`));
        break;
      }
    }

    return out;
  }

  /** Finalise any buffered partial text for an agent (e.g. when the
   *  caller knows the agent has ended but no terminal event arrived). */
  close(agentName: string): EmittedLine[] {
    const pending = this.flushBuffer(agentName);
    if (pending === null) return [];
    return [this.line(agentName, 'text', pending)];
  }

  /** Reset state (tests). */
  reset(): void {
    this.textBuffer.clear();
    this.lastAgent = null;
    this.terminatedAgents.clear();
  }

  // ── internals ──

  private flushBuffer(agentName: string): string | null {
    const buf = this.textBuffer.get(agentName);
    if (!buf) return null;
    this.textBuffer.set(agentName, '');
    return buf;
  }

  private line(agentName: string, kind: LogLineMeta['kind'], body: string): EmittedLine {
    const colorize = this.opts.color(agentName);
    const tag = colorize(`[${agentName}]`);
    const bodyText = kind === 'status' ? this.opts.dim(body) : body;
    const text = `${this.opts.linePrefix}${tag} ${bodyText}`;
    const threadStart = this.lastAgent !== agentName;
    const threadEnd = kind === 'status' && this.terminatedAgents.has(agentName);
    this.lastAgent = agentName;
    return {
      text,
      meta: { agent: agentName, kind, threadStart, threadEnd },
    };
  }
}

// ── HUD helpers ──

/** Summarise an AgentRegistry's live state for the log pane HUD.
 *  Examples:
 *   - `⟳ 3/5 agents running`
 *   - `✓ all 5 agents done`
 *   - (empty string when no tasks are registered)
 *
 *  Works on an abstract counts object so tests don't need to build a
 *  full registry.
 */
export interface AgentCounts {
  running: number;
  done: number;
  error: number;
  aborted: number;
  pending: number;
}

export function agentCounts(tasks: Array<{ state: string }>): AgentCounts {
  const c: AgentCounts = { running: 0, done: 0, error: 0, aborted: 0, pending: 0 };
  for (const t of tasks) {
    if (t.state === 'running')  c.running++;
    else if (t.state === 'done') c.done++;
    else if (t.state === 'error') c.error++;
    else if (t.state === 'aborted') c.aborted++;
    else if (t.state === 'pending') c.pending++;
  }
  return c;
}

export function hudSummary(counts: AgentCounts): string {
  const total = counts.running + counts.done + counts.error + counts.aborted + counts.pending;
  if (total === 0) return '';
  const live = counts.running + counts.pending;
  if (live > 0) return `⟳ ${counts.done + counts.error + counts.aborted}/${total} agents · ${live} in flight`;
  if (counts.error + counts.aborted === 0) return `✓ all ${total} agents done`;
  return `● ${counts.done} ok · ${counts.error} err · ${counts.aborted} abort / ${total}`;
}

// ── util ──

/** Compact JSON for args — single line, truncated to keep log scannable. */
function stringifyArgsCompact(args: Record<string, unknown>, max = 120): string {
  try {
    const s = JSON.stringify(args);
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  } catch { return '{…}'; }
}

function stringifyResultCompact(result: unknown, max = 140): string {
  try {
    const s = typeof result === 'string' ? result : JSON.stringify(result);
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  } catch { return '…'; }
}

export { agentColorNoop };
