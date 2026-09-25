// Wave P2 (presentation) · A1-1 — inline agent progress block.
//
// Renders a chat-surface block showing the current sub-agent fleet so
// the operator sees activity without opening the roster widget. Tree
// drawing matches claude-code-fork's `AgentProgressLine`
// (`tools/AgentTool/UI.tsx:33-180,505-570` · `components/AgentProgressLine.tsx:23-135`)
// adapted to monad's chatLines string[] surface and tree-prefix
// idioms.
//
// Pure function — no side effects. Caller composes the block and
// hands it to `rendered-tool-runtime.replaceBlock` under a stable
// callId. Presentation is content-non-mutating: the AgentSurfaceStore
// remains the source of truth, this only formats a snapshot.

export interface AgentProgressEntry {
  id: string;
  /** Display name (agent label or definition description). */
  name: string;
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  /** Tool calls dispatched by this agent so far. */
  toolCount: number;
  /** Optional one-line tail showing the most recent tool invocation
   *  (e.g. `Read src/foo.ts` or `Bash 'rg pattern'`). */
  lastToolText?: string;
  /** Elapsed time in ms — formatted as `Ns` / `Nm Ns` if shown. */
  elapsedMs?: number;
}

export interface AgentProgressBlockOptions {
  /** Cap how many agents render in detail. Excess agents collapse to
   *  a `+N more` line. Default 3 (claude-code-fork MAX_PROGRESS). */
  maxDisplay?: number;
  /** Theme color helpers — kept indirection-free so tests can pass
   *  identity functions and assert on the plain text shape. */
  colors?: {
    muted?: (s: string) => string;
    running?: (s: string) => string;
    done?: (s: string) => string;
    error?: (s: string) => string;
  };
}

const DEFAULT_MAX_DISPLAY = 3;

const ID = (s: string): string => s;

export function formatAgentElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem === 0 ? `${min}m` : `${min}m ${rem}s`;
}

function statusGlyph(status: AgentProgressEntry['status']): string {
  switch (status) {
    case 'queued': return '○';
    case 'running': return '●';
    case 'done': return '✓';
    case 'error': return '✗';
    case 'cancelled': return '⊘';
  }
}

function colorForStatus(
  status: AgentProgressEntry['status'],
  colors: AgentProgressBlockOptions['colors'],
): (s: string) => string {
  if (!colors) return ID;
  if (status === 'running' || status === 'queued') return colors.running ?? ID;
  if (status === 'done') return colors.done ?? ID;
  if (status === 'error' || status === 'cancelled') return colors.error ?? ID;
  return ID;
}

function summarizeFleet(entries: ReadonlyArray<AgentProgressEntry>): string {
  let running = 0;
  let done = 0;
  let error = 0;
  for (const e of entries) {
    if (e.status === 'running' || e.status === 'queued') running++;
    else if (e.status === 'done') done++;
    else if (e.status === 'error' || e.status === 'cancelled') error++;
  }
  const parts: string[] = [];
  if (running > 0) parts.push(`${running} running`);
  if (done > 0) parts.push(`${done} done`);
  if (error > 0) parts.push(`${error} error`);
  return parts.length > 0 ? parts.join(' · ') : `${entries.length} agents`;
}

/** Render a chat-surface block describing the active sub-agent fleet.
 *  Empty input → empty output (caller skips the replaceBlock call).
 *  Output is wrap-friendly plain text; ANSI color is opt-in via the
 *  `colors` option so tests can assert on geometry. */
export function renderAgentProgressBlock(
  entries: ReadonlyArray<AgentProgressEntry>,
  opts: AgentProgressBlockOptions = {},
): string[] {
  if (entries.length === 0) return [];

  const max = Math.max(1, opts.maxDisplay ?? DEFAULT_MAX_DISPLAY);
  const muted = opts.colors?.muted ?? ID;

  const visible = entries.slice(0, max);
  const overflow = entries.length - visible.length;

  const lines: string[] = [];
  lines.push(muted(`Agents · ${summarizeFleet(entries)}`));

  for (let i = 0; i < visible.length; i++) {
    const entry = visible[i]!;
    const isLast = i === visible.length - 1 && overflow === 0;
    const branch = isLast ? '└─' : '├─';
    const color = colorForStatus(entry.status, opts.colors);
    const headParts: string[] = [
      `${branch} ${color(statusGlyph(entry.status))} ${entry.name}`,
      muted(`${entry.toolCount} tool${entry.toolCount === 1 ? '' : 's'}`),
    ];
    if (typeof entry.elapsedMs === 'number' && entry.elapsedMs > 0) {
      headParts.push(muted(formatAgentElapsed(entry.elapsedMs)));
    }
    lines.push(headParts.join(' · '));
    if (entry.lastToolText) {
      const indent = isLast ? '   ' : '│  ';
      lines.push(`${indent}${muted(entry.lastToolText)}`);
    }
  }

  if (overflow > 0) {
    lines.push(`└─ ${muted(`+${overflow} more`)}`);
  }

  return lines;
}
