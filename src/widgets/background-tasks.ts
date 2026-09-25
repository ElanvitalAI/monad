// Wave P4a-2 (presentation) · A3-1 follow-up — manager modal widget.
//
// Unified list of every active background work item — shells,
// sub-agents, workflow runs — in a single surface. Wave P4a-3 wires
// kill / abort actions on top of this widget; this PR ships the
// read-only list + j/k cursor + per-row presentation so the user has
// a single place to look.
//
// Surface-unification v2.2 V2.2-5 (2026-05-11) — `scheduler` source
// retired (scheduler view 폐기). Recurring jobs now surface as workflow
// runs · the `workflow` row already covers them.

import type { WidgetDef } from './types.js';

export type BackgroundTaskSource = 'agent' | 'shell' | 'workflow';
export type BackgroundTaskStatus =
  | 'queued'
  | 'running'
  | 'done'
  | 'error'
  | 'aborted'
  | 'paused';

export interface BackgroundTaskRow {
  id: string;
  source: BackgroundTaskSource;
  /** Display label (agent name / shell command / workflow id / job
   *  title). Truncated to ctx.width by the renderer. */
  label: string;
  status: BackgroundTaskStatus;
  /** Optional one-line tail (last tool / step index / exit code). */
  detail?: string;
  /** Elapsed time in ms since start; undefined for steady-state
   *  rows (queued / paused). */
  elapsedMs?: number;
  /** Wave P4a-3 will read this to know whether `d` (kill / abort)
   *  is allowed. Default false in this PR — actions land in P4a-3. */
  abortable?: boolean;
}

// Surface-unification v2.2 V2.2-5 (2026-05-11) — 'pause' action retired
// (was scheduler-only).
export type BackgroundTaskAction = 'abort';

export interface BackgroundTasksWidgetState {
  rows: BackgroundTaskRow[];
  cursor: number;
  /** Set after an `onAction` dispatch so the renderer can dim the
   *  row (visual feedback) until the next refresh removes it. */
  pendingActionRowId?: string;
  /** Wave P4a-3 — host-supplied dispatcher for `d` (abort / kill) /
   *  `p` (pause). Stored on state so onKey can fire it without
   *  threading WidgetContext through every closure. */
  onAction?: (rowId: string, action: BackgroundTaskAction, source: BackgroundTaskSource) => void;
}

export interface BackgroundTasksWidgetConfig {
  rows?: BackgroundTaskRow[];
  /** Receives the cursor row's id + the requested action. The host
   *  decodes the id (`source:nativeId`) and dispatches the matching
   *  registry call (shellRegistry.kill / globalAgentRegistry.abort /
   *  globalWorkflowRunner().abort). The widget itself stays
   *  presentation-only. */
  onAction?: (rowId: string, action: BackgroundTaskAction, source: BackgroundTaskSource) => void;
}

const SOURCE_GLYPH: Record<BackgroundTaskSource, string> = {
  agent: '◆',
  shell: '▫',
  workflow: '⚙',
};

const STATUS_GLYPH: Record<BackgroundTaskStatus, string> = {
  queued: '○',
  running: '●',
  done: '✓',
  error: '✗',
  aborted: '⊘',
  paused: '⏸',
};

function formatElapsed(ms: number | undefined): string {
  if (ms === undefined || ms <= 0) return '';
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem === 0 ? `${min}m` : `${min}m ${rem}s`;
}

function truncate(s: string, max: number): string {
  if (max <= 0) return '';
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + '…';
}

function fitWidth(line: string, width: number): string {
  if (width <= 0) return line;
  if (line.length === width) return line;
  if (line.length < width) return line + ' '.repeat(width - line.length);
  return line.slice(0, width);
}

export function renderBackgroundTaskRow(row: BackgroundTaskRow, width: number): string {
  const sourceGlyph = SOURCE_GLYPH[row.source];
  const statusGlyph = STATUS_GLYPH[row.status];
  const elapsed = formatElapsed(row.elapsedMs);
  const head = `${sourceGlyph} ${statusGlyph} ${row.label}`;
  const tailSegments: string[] = [];
  if (row.detail) tailSegments.push(row.detail);
  if (elapsed) tailSegments.push(elapsed);
  const tail = tailSegments.length > 0 ? `  ${tailSegments.join(' · ')}` : '';
  // Reserve 2 chars for cursor prefix added by the widget render.
  const budget = Math.max(1, width - 2);
  return truncate(head + tail, budget);
}

const widget: WidgetDef<BackgroundTasksWidgetState, BackgroundTasksWidgetConfig> = {
  type: 'background-tasks',
  description: 'Unified list of active background tasks across shell / agent / workflow.',

  initialState(config) {
    return {
      rows: config?.rows ? [...config.rows] : [],
      cursor: 0,
      ...(config?.onAction ? { onAction: config.onAction } : {}),
    };
  },

  render(state, ctx) {
    const lines: string[] = [];
    if (state.rows.length === 0) {
      lines.push(fitWidth('No active background tasks.', ctx.width));
      return lines;
    }
    // Wave P4c — group rows by source so the operator scans by
    // category (◆ AGENT (3) → rows / ▫ SHELL (1) → rows / ...) instead
    // of a flat interleaved list. The cursor still indexes into
    // state.rows[] in source-priority order so j/k/d/p semantics stay
    // intact.
    const SOURCE_ORDER: BackgroundTaskSource[] = ['agent', 'shell', 'workflow'];
    const grouped = new Map<BackgroundTaskSource, BackgroundTaskRow[]>();
    for (const r of state.rows) {
      const bucket = grouped.get(r.source) ?? [];
      bucket.push(r);
      grouped.set(r.source, bucket);
    }
    let absoluteIdx = 0;
    for (const source of SOURCE_ORDER) {
      const bucket = grouped.get(source);
      if (!bucket || bucket.length === 0) continue;
      const headerLabel = source.toUpperCase();
      const sourceGlyph = SOURCE_GLYPH[source];
      lines.push(fitWidth(`${sourceGlyph} ${headerLabel} (${bucket.length})`, ctx.width));
      if (lines.length >= ctx.height) break;
      for (const r of bucket) {
        const body = renderBackgroundTaskRow(r, ctx.width);
        const cursor = absoluteIdx === state.cursor ? '> ' : '  ';
        lines.push(fitWidth(`${cursor}${body}`, ctx.width));
        absoluteIdx++;
        if (lines.length >= ctx.height) break;
      }
      if (lines.length >= ctx.height) break;
    }
    return lines;
  },

  onKey(ev, state) {
    const max = state.rows.length - 1;
    if (max < 0) return { type: 'none' };
    switch (ev.name) {
      case 'j':
      case 'down':
        state.cursor = Math.min(state.cursor + 1, max);
        return { type: 'refresh' };
      case 'k':
      case 'up':
        state.cursor = Math.max(state.cursor - 1, 0);
        return { type: 'refresh' };
      case 'g':
      case 'home':
        state.cursor = 0;
        return { type: 'refresh' };
      case 'G':
      case 'end':
        state.cursor = max;
        return { type: 'refresh' };
      case 'd': {
        // Wave P4a-3 — abort / kill cursor row. The widget itself
        // doesn't reach into source registries; the host injects
        // `onAction` and handles the per-source dispatch.
        const row = state.rows[state.cursor];
        if (!row) return { type: 'none' };
        if (row.abortable === false) return { type: 'none' };
        state.pendingActionRowId = row.id;
        state.onAction?.(row.id, 'abort', row.source);
        return { type: 'refresh' };
      }
      // Surface-unification v2.2 V2.2-5 (2026-05-11) — `p` (pause)
      // key 제거. pause 는 scheduler-only 액션이었고 그 source 는
      // retire 됨. agent/shell/workflow 는 `d` (abort) 만 지원.
      default:
        return { type: 'none' };
    }
  },
};

export default widget;
