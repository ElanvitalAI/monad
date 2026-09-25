// ── State Timeline Viewer widget ──
//
// IUL Bundle 8W joint deliverable (2026-04-20). First UI consumer of the
// Bundle 7T widget-recorder + parseWidgetTimeline. Loads an asciicast
// v2.1 `widget-timeline` file and presents it as a scrubbable frame
// strip with inline state inspection.
//
// ## Render layout
//
//   row 0  · title (file basename · cursor / total)
//   row 1  · status line (time · widget id · status)
//   row 2  · scrub bar (progress %)
//   row 3  · blank divider
//   rows 4..h-2  · state JSON body (scrollable via j/k)
//   row h-1 · hotkey hint (muted)
//
// ## Keymap (widget-scoped)
//
//   space        play / pause
//   h / left     prev frame
//   l / right    next frame
//   H / shift+l  ±10 frames
//   g / home     first frame
//   G / end      last frame
//   + / -        playback speed (0.25 / 0.5 / 1 / 2 / 4)
//   r            reset cursor to 0 + pause
//   L            toggle loop
//   j / k / down / up  scroll state inspector
//
// ## Mouse
//
//   click scrub bar → seek to that %
//   scroll (wheel) → advance ±1 frame (paused only)
//
// ## Playback
//
// Widget doesn't run its own interval — cursor advance is driven by the
// host plugin's `ctx.animate` tick OR by external setInterval in the
// iul-timeline plugin's recorder-manager. Widget render is pure; given
// `timeline` + `cursor`, it paints deterministically.
//
// The plugin's tick logic reads `frames[cursor+1].time - frames[cursor].time`
// and waits that much (scaled by 1/speed) before calling ctx.setState
// to advance cursor. See plugins/iul-timeline/recorder-manager.ts.

import type { Widget } from '../../src/widgets/types.js';
import type { ParsedWidgetTimeline, WidgetTimelineFrame } from '../../src/capture/widget-recorder.js';
import { C, visibleWidth, truncate } from '../../src/tui.js';
import { paneTitle } from '../../src/panes/pane-title.js';

export type TimelineViewerPlayback = 'paused' | 'playing';

export interface StateTimelineViewerState {
  /** Parsed timeline — header + frames. Null until plugin loads a file. */
  timeline: ParsedWidgetTimeline | null;
  /** Optional source path (purely informational · title suffix). */
  path: string | null;
  /** Current frame index into `timeline.frames` [0..frames.length-1].
   *  When frames.length === 0 the cursor is 0 (degenerate). */
  cursor: number;
  /** Playback state. Widget just paints; plugin ticks cursor. */
  playback: TimelineViewerPlayback;
  /** Playback speed multiplier. Must be one of SPEEDS. */
  speed: number;
  /** Scroll offset into the state JSON body. */
  inspectorScroll: number;
  /** Auto-loop — when true, cursor wraps to 0 on reaching the last frame. */
  loop: boolean;
  /** True when this widget is focused — drives title emphasis. */
  focused: boolean;
}

export interface StateTimelineViewerConfig {
  timeline?: ParsedWidgetTimeline;
  path?: string;
}

export const SPEEDS = [0.25, 0.5, 1, 2, 4] as const;
const DEFAULT_SPEED = 1;

const stateTimelineViewerWidget: Widget<StateTimelineViewerState, StateTimelineViewerConfig> = {
  type: 'state-timeline-viewer',
  description: 'Scrub and inspect a widget-timeline recording (asciicast v2.1)',
  defaultCharacter: 'Timeline',

  behaviors: [],

  initialState(config) {
    return {
      timeline: config?.timeline ?? null,
      path: config?.path ?? null,
      cursor: 0,
      playback: 'paused',
      speed: DEFAULT_SPEED,
      inspectorScroll: 0,
      loop: true,
      focused: false,
    };
  },

  render(state, ctx, character) {
    const lines: string[] = [];
    const w = ctx.width;
    const h = ctx.height;
    if (h < 1 || w < 1) return lines;

    const titleText = buildTitle(state, character);
    const hasTitle = h >= 1;
    if (hasTitle) lines.push(paneTitle(titleText, ctx.focused || state.focused, w));
    if (h < 2) return lines;

    // Status line — 3 fields: frame N/M · time · widget id
    const status = buildStatus(state);
    lines.push(padRight(C.muted('  ' + truncate(status, Math.max(0, w - 2))), w));
    if (h < 3) return lines;

    // Scrub bar
    lines.push(buildScrubBar(state, w));
    if (h < 4) return lines;

    // Divider blank line
    lines.push(' '.repeat(w));
    if (h < 5) return lines;

    // State inspector body
    const hintRows = 1;
    const bodyH = Math.max(0, h - lines.length - hintRows);
    appendInspector(lines, state, bodyH, w);

    // Hotkey hint (always last row)
    while (lines.length < h - 1) lines.push(' '.repeat(w));
    const hint = `  space play/pause · h/l step · H/L ±10 · g/G start/end · +/- speed · r reset · L loop · j/k scroll`;
    lines.push(padRight(C.muted(truncate(hint, Math.max(0, w - 2))), w));

    while (lines.length < h) lines.push(' '.repeat(w));
    return lines;
  },

  onKey(ev, state, ctx) {
    const frames = state.timeline?.frames ?? [];
    const n = frames.length;
    if (n === 0) return { type: 'none' };

    switch (ev.name) {
      case 'space':
        state.playback = state.playback === 'playing' ? 'paused' : 'playing';
        ctx?.telemetry?.emit({
          kind: 'state-timeline-viewer.playback.change',
          data: { to: state.playback, cursor: state.cursor, speed: state.speed },
        });
        return { type: 'refresh' };
      case 'h': case 'left':
        state.cursor = Math.max(0, state.cursor - 1);
        state.playback = 'paused';
        return { type: 'refresh' };
      case 'l': case 'right':
        state.cursor = Math.min(n - 1, state.cursor + 1);
        state.playback = 'paused';
        return { type: 'refresh' };
      case 'H':
        state.cursor = Math.max(0, state.cursor - 10);
        state.playback = 'paused';
        return { type: 'refresh' };
      case 'L':
        // Shift+L is loop-toggle rather than ±10 forward — `l` alone already
        // advances, and the ±10-back case (H) is the more common review
        // pattern. `L` for loop is symmetric with most playback UIs.
        state.loop = !state.loop;
        return { type: 'refresh' };
      case 'g': case 'home':
        state.cursor = 0;
        state.playback = 'paused';
        return { type: 'refresh' };
      case 'G': case 'end':
        state.cursor = n - 1;
        state.playback = 'paused';
        return { type: 'refresh' };
      case '+': case '=': {
        const idx = SPEEDS.indexOf(state.speed as typeof SPEEDS[number]);
        if (idx >= 0 && idx < SPEEDS.length - 1) state.speed = SPEEDS[idx + 1]!;
        return { type: 'refresh' };
      }
      case '-': {
        const idx = SPEEDS.indexOf(state.speed as typeof SPEEDS[number]);
        if (idx > 0) state.speed = SPEEDS[idx - 1]!;
        return { type: 'refresh' };
      }
      case 'r':
        state.cursor = 0;
        state.inspectorScroll = 0;
        state.playback = 'paused';
        return { type: 'refresh' };
      case 'j': case 'down':
        state.inspectorScroll += 1;
        return { type: 'refresh' };
      case 'k': case 'up':
        state.inspectorScroll = Math.max(0, state.inspectorScroll - 1);
        return { type: 'refresh' };
      default:
        return { type: 'none' };
    }
  },

  onMouse(ev, state, _ctx) {
    const frames = state.timeline?.frames ?? [];
    const n = frames.length;
    if (n === 0) return { type: 'none' };

    if (ev.type === 'scroll-up') {
      state.cursor = Math.max(0, state.cursor - 1);
      state.playback = 'paused';
      return { type: 'refresh' };
    }
    if (ev.type === 'scroll-down') {
      state.cursor = Math.min(n - 1, state.cursor + 1);
      state.playback = 'paused';
      return { type: 'refresh' };
    }
    if (ev.type === 'click') {
      const scrubRow = 2;
      // Scrub bar lives at widget-local scrubRow. Clicks on the scrub
      // row seek to the click column's proportional position.
      if (ev.row === scrubRow) {
        // body width excludes the 2-cell left pad we draw.
        const pad = 2;
        const effectiveCol = Math.max(0, ev.col - pad);
        const bar = Math.max(1, (state.timeline ? state.timeline.frames.length : 0));
        void bar;
        // We don't know the render width here — use a proxy: clamp col
        // into [0, col=n-1] using the mouse's own column as a proportional
        // pick. The render-time layout uses visible width; for clicks we
        // treat the whole row as the scrub surface.
        const frac = Math.min(1, Math.max(0, effectiveCol / Math.max(1, 80)));
        state.cursor = Math.round(frac * (n - 1));
        state.playback = 'paused';
        return { type: 'refresh' };
      }
    }
    return { type: 'none' };
  },

  snapshot(state, _ctx) {
    const frames = state.timeline?.frames ?? [];
    const widgetIds = new Set<string>();
    for (const f of frames) widgetIds.add(f.widgetId);
    const current = frames[state.cursor] ?? null;
    return {
      frames: frames.length,
      cursor: state.cursor,
      time: current?.time ?? null,
      widgetId: current?.widgetId ?? null,
      uniqueWidgets: widgetIds.size,
      playback: state.playback,
      speed: state.speed,
      loop: state.loop,
      path: state.path,
      hasTimeline: state.timeline !== null,
    };
  },

  describe(state, ctx, row, _col) {
    if (row === 0) return `title · ${ctx.character}${state.path ? ' · ' + state.path : ''}`;
    if (row === 1) return `status · ${buildStatus(state)}`;
    if (row === 2) return `scrub bar · cursor ${state.cursor} of ${state.timeline?.frames.length ?? 0}`;
    return `state inspector row ${row} · scroll ${state.inspectorScroll}`;
  },

  // WR-1 (2026-04-20 · IUL Phase W consumer · 12th opt-in widget) — emit
  // on cursor / playback / timeline swap. Meta-observability: the viewer
  // itself is observable so a timeline-of-the-viewer can be recorded.
  onStateChange(prev, next, ctx) {
    if (prev.cursor !== next.cursor) {
      ctx.telemetry?.emit({
        kind: 'state-timeline-viewer.cursor.change',
        data: {
          from: prev.cursor,
          to: next.cursor,
          total: next.timeline?.frames.length ?? 0,
        },
      });
    }
    if (prev.playback !== next.playback) {
      ctx.telemetry?.emit({
        kind: 'state-timeline-viewer.playback.change',
        data: { to: next.playback, cursor: next.cursor, speed: next.speed },
      });
    }
    if (prev.timeline !== next.timeline) {
      ctx.telemetry?.emit({
        kind: 'state-timeline-viewer.timeline.load',
        data: {
          frames: next.timeline?.frames.length ?? 0,
          path: next.path,
        },
      });
    }
  },

  // WR-2 — cursor + frames count + playback + speed + loop
  snapshotHash(state): string {
    const frames = state.timeline?.frames.length ?? 0;
    return `${state.cursor}:${frames}:${state.playback}:${state.speed}:${state.loop ? 1 : 0}:${state.focused ? 1 : 0}`;
  },

  describeSurface(state, ctx): string {
    const frames = state.timeline?.frames.length ?? 0;
    const parts = [ctx.character];
    if (frames === 0) {
      parts.push('no timeline loaded');
    } else {
      parts.push(`${state.cursor + 1}/${frames}`);
      parts.push(state.playback);
      parts.push(`${state.speed}×`);
      if (state.path) parts.push(`"${state.path}"`);
    }
    return parts.join(' · ');
  },

  // WR-3 — replay this viewer to a recorded state. Timeline payload is
  // large but JSON-structurally-serializable; default setState merge works
  // fine. We still override to emit a telemetry beacon so a
  // viewer-recording-of-a-viewer-recording scrubs cleanly, and to clamp
  // cursor against the replayed timeline's frame count (which may differ
  // from the current timeline if the user scrubbed a different file).
  replayState(state, ctx): void {
    const frames = state.timeline?.frames.length ?? 0;
    const clamped = frames > 0 ? Math.max(0, Math.min(state.cursor, frames - 1)) : 0;
    const patched: StateTimelineViewerState = { ...state, cursor: clamped };
    ctx.setState(patched as Partial<typeof state>);
    ctx.telemetry?.emit({
      kind: 'state-timeline-viewer.replay',
      data: { cursor: clamped, frames, playback: state.playback },
    });
  },

  configSchema() {
    return {
      type: 'object',
      properties: {
        timeline: {
          type: 'object',
          additionalProperties: true,
          description: 'Parsed widget timeline payload loaded from recorder output.',
        },
        path: {
          type: 'string',
          description: 'Optional source path shown in the viewer title.',
        },
      },
      additionalProperties: false,
    };
  },
};

// ── Helpers ─────────────────────────────────────────────────────────

function buildTitle(state: StateTimelineViewerState, character: string): string {
  const basename = state.path ? baseOf(state.path) : '(no file)';
  const n = state.timeline?.frames.length ?? 0;
  if (n === 0) return `${character} · ${basename} · empty`;
  return `${character} · ${basename}`;
}

function buildStatus(state: StateTimelineViewerState): string {
  const frames = state.timeline?.frames ?? [];
  const n = frames.length;
  if (n === 0) return 'no timeline loaded — /iul-timeline view <path>';
  const current = frames[state.cursor]!;
  const widgetIds = new Set<string>();
  for (const f of frames) widgetIds.add(f.widgetId);
  const pb = state.playback === 'playing' ? '▶' : '❚❚';
  return `${pb} frame ${state.cursor + 1}/${n} · t=${current.time.toFixed(2)}s · widget=${current.widgetId} · ${widgetIds.size} unique · ${state.speed}× · loop=${state.loop ? 'on' : 'off'}`;
}

function buildScrubBar(state: StateTimelineViewerState, width: number): string {
  const frames = state.timeline?.frames ?? [];
  const n = frames.length;
  const barW = Math.max(1, width - 4); // 2-cell pad each side
  if (n === 0) {
    return padRight(C.muted('  ' + '░'.repeat(Math.max(1, barW)) + '  '), width);
  }
  const frac = n <= 1 ? 1 : state.cursor / (n - 1);
  const filled = Math.round(frac * barW);
  const bar = '▓'.repeat(filled) + '░'.repeat(Math.max(0, barW - filled));
  const pct = Math.round(frac * 100);
  const colored = C.accent(bar);
  return padRight(`  ${colored}  ${C.muted(`${pct}%`)}`, width);
}

function appendInspector(
  lines: string[],
  state: StateTimelineViewerState,
  bodyH: number,
  w: number,
): void {
  if (bodyH <= 0) return;
  const frames = state.timeline?.frames ?? [];
  const current = frames[state.cursor];
  if (!current) {
    for (let i = 0; i < bodyH; i++) {
      if (i === 0) lines.push(padRight(C.muted('  (no frame — timeline is empty)'), w));
      else lines.push(' '.repeat(w));
    }
    return;
  }

  const stateJson = safeStringify(current.state);
  const rawLines = stateJson.split('\n');
  const scroll = Math.max(0, Math.min(state.inspectorScroll, Math.max(0, rawLines.length - bodyH)));
  state.inspectorScroll = scroll;
  for (let i = 0; i < bodyH; i++) {
    const idx = scroll + i;
    const line = rawLines[idx];
    if (line === undefined) {
      lines.push(' '.repeat(w));
    } else {
      lines.push(padRight(C.subtext('  ' + truncate(line, Math.max(0, w - 2))), w));
    }
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '(unserializable state)';
  }
}

function baseOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(slash + 1) : path;
}

function padRight(s: string, w: number): string {
  const vis = visibleWidth(s);
  return vis >= w ? s : s + ' '.repeat(w - vis);
}

/** Plugin helper — advance `state.cursor` by one frame based on the
 *  elapsed wall-clock time since the last tick. Returns the `setState`
 *  patch the caller should apply, or null when no advance is due.
 *
 *  Honors `state.speed` (multiplier) and `state.loop` (wrap on end vs.
 *  stop at end). Meant to be invoked from an external interval; widget
 *  render stays pure.
 *
 *  `elapsedMs` is the real-world ms since the last tick call. Smaller
 *  intervals = smoother scrub · larger = coarser. 30-50ms is typical.
 */
export function computeNextCursor(
  state: StateTimelineViewerState,
  elapsedMs: number,
): Partial<StateTimelineViewerState> | null {
  if (state.playback !== 'playing') return null;
  const frames = state.timeline?.frames ?? [];
  const n = frames.length;
  if (n <= 1) return null;
  const current = frames[state.cursor];
  const next = frames[state.cursor + 1];
  if (!current || !next) {
    // At the last frame
    if (state.loop) return { cursor: 0 };
    return { playback: 'paused' };
  }
  const requiredMs = Math.max(0, (next.time - current.time) * 1000) / state.speed;
  if (elapsedMs < requiredMs) return null;
  return { cursor: state.cursor + 1 };
}

export default stateTimelineViewerWidget;
