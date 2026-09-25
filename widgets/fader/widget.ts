// ── Fader widget ──
//
// Phase 4 P2a consumer (2026-04-20) — pure animation consumer, no
// canvas. Displays a short message that fades in on mount and can be
// dismissed (with fade-out) via `dismiss()` invoked through onKey or
// externally by the host. Intended as a toast / ephemeral banner
// primitive; host layouts can overlay it on any pane.
//
// State:
//   - message: string     (required — what shows in the pane)
//   - visible: boolean    (host can set to false to trigger fade-out)
//   - phase: 'fade-in' | 'shown' | 'fade-out' | 'hidden'
//
// Animation:
//   - onMount: tween 'fade-in' duration 200ms easeOut
//   - phase === 'fade-out' after user dismiss: tween 'fade-out'
//     duration 200ms easeIn, then phase = 'hidden' on completion
//
// Rendering:
//   - opacity 0..1 derived from current phase + progress
//   - dim/bright message based on opacity bucket; the renderer simply
//     swaps between bright/dim chalk colors (terminal won't do true
//     alpha). phase 'hidden' renders blank.

import type { Widget } from '../../src/widgets/types.js';
import { C, truncate, visibleWidth } from '../../src/tui.js';
import { paneTitle } from '../../src/panes/pane-title.js';

export type FaderPhase = 'fade-in' | 'shown' | 'fade-out' | 'hidden';

export interface FaderState {
  message: string;
  phase: FaderPhase;
  /** Optional tone — affects color when 'shown'. */
  tone?: 'info' | 'success' | 'warning' | 'error';
  /** Total visible time before auto-dismiss (ms). 0 = manual only. */
  autoDismissMs?: number;
  /** Mount time (ms, Date.now()) — used for auto-dismiss math. */
  mountedAt?: number;
}

export interface FaderConfig {
  message?: string;
  tone?: FaderState['tone'];
  autoDismissMs?: number;
}

const FADE_MS = 200;

const faderWidget: Widget<FaderState, FaderConfig> = {
  type: 'fader',
  description: 'Ephemeral toast / banner with fade-in/out animation',
  defaultCharacter: 'Notice',

  initialState(config) {
    return {
      message: config?.message ?? '',
      phase: 'fade-in',
      tone: config?.tone ?? 'info',
      autoDismissMs: config?.autoDismissMs ?? 0,
    };
  },

  onMount(state, ctx) {
    state.mountedAt = Date.now();
    ctx.animate?.tween({
      key: 'fader.opacity',
      durationMs: FADE_MS,
      curve: 'easeOut',
      onDone: () => {
        if (state.phase === 'fade-in') state.phase = 'shown';
      },
    });
    ctx.telemetry?.emit({ kind: 'fader.mounted', data: { tone: state.tone } });
  },

  render(state, ctx, character) {
    const lines: string[] = [];
    const w = ctx.width;
    const h = ctx.height;
    if (h < 1 || w < 1) return lines;

    // Compute current opacity.
    const animProgress = ctx.animate?.progress('fader.opacity') ?? 1;
    let opacity = 0;
    if (state.phase === 'fade-in') {
      opacity = animProgress;
      if (opacity >= 1) state.phase = 'shown';
    } else if (state.phase === 'shown') {
      opacity = 1;
      if (state.autoDismissMs && state.autoDismissMs > 0 && state.mountedAt != null) {
        const elapsed = Date.now() - state.mountedAt;
        if (elapsed >= FADE_MS + state.autoDismissMs) {
          state.phase = 'fade-out';
          ctx.animate?.tween({
            key: 'fader.opacity',
            durationMs: FADE_MS,
            curve: 'easeIn',
            onDone: () => { state.phase = 'hidden'; },
          });
        }
      }
    } else if (state.phase === 'fade-out') {
      opacity = 1 - animProgress;
      if (opacity <= 0) state.phase = 'hidden';
    } else {
      opacity = 0;
    }

    const hasTitle = h >= 2;
    if (hasTitle) lines.push(paneTitle(character, ctx.focused, w));

    const body = state.phase === 'hidden' ? '' : state.message;
    const painted = paintLine(body, opacity, state.tone ?? 'info', w);
    lines.push(padRight(painted, w));
    while (lines.length < h) lines.push(' '.repeat(w));
    return lines;
  },

  onKey(ev, state, ctx) {
    // Any key during 'shown' dismisses.
    if (ev.name === 'escape' || ev.name === 'enter' || ev.name === 'space') {
      if (state.phase === 'shown' || state.phase === 'fade-in') {
        state.phase = 'fade-out';
        ctx.animate?.tween({
          key: 'fader.opacity',
          durationMs: FADE_MS,
          curve: 'easeIn',
          onDone: () => { state.phase = 'hidden'; },
        });
        ctx.telemetry?.emit({ kind: 'fader.dismissed', data: { reason: 'user' } });
        return { type: 'refresh' };
      }
    }
    return { type: 'none' };
  },

  onMouse(ev, state, ctx) {
    if (
      (ev.type === 'click' || ev.type === 'double-click')
      && (state.phase === 'shown' || state.phase === 'fade-in')
    ) {
      state.phase = 'fade-out';
      ctx.animate?.tween({
        key: 'fader.opacity',
        durationMs: FADE_MS,
        curve: 'easeIn',
        onDone: () => { state.phase = 'hidden'; },
      });
      ctx.telemetry?.emit({ kind: 'fader.dismissed', data: { reason: 'mouse' } });
      return { type: 'refresh' };
    }
    return { type: 'none' };
  },

  snapshot(state, _ctx) {
    const now = Date.now();
    const age = state.mountedAt ? now - state.mountedAt : 0;
    return {
      message: state.message,
      phase: state.phase,
      tone: state.tone ?? null,
      autoDismissMs: state.autoDismissMs ?? 0,
      ageMs: age,
    };
  },

  describe(state, ctx, row, _col) {
    if (row === 0) return `title row (${ctx.character})`;
    return `fader body: phase=${state.phase} · message="${truncate(state.message, 40)}"`;
  },

  // WR-1 (Bundle 7W · 2026-04-20) — fader is a visibility surface, so
  // the axis that matters for a recorder is the phase transition (the
  // 'fade-in' → 'shown' → 'fade-out' → 'hidden' arc). Message changes
  // are also worth marking: a host swapping "err 1" → "err 2" wants a
  // distinct scrub point. Tone transitions are rare but land an event
  // too — fader-as-toast uses tone to encode severity.
  onStateChange(prev, next, ctx) {
    if (prev.phase !== next.phase) {
      ctx.telemetry?.emit({
        kind: 'fader.phase.change',
        data: { from: prev.phase, to: next.phase, tone: next.tone ?? null },
      });
    }
    if (prev.message !== next.message) {
      ctx.telemetry?.emit({
        kind: 'fader.message.change',
        data: { length: next.message.length, phase: next.phase },
      });
    }
    if (prev.tone !== next.tone) {
      ctx.telemetry?.emit({
        kind: 'fader.tone.change',
        data: { from: prev.tone ?? null, to: next.tone ?? null },
      });
    }
  },

  // WR-2 — phase + tone + message length + autoDismiss. Message content
  // is collapsed to length so rapid character-by-character rewrites
  // (uncommon) don't spam the hash; length-collision is tolerable per
  // WR-2 contract.
  snapshotHash(state): string {
    return `${state.phase}:${state.tone ?? '_'}:${state.message.length}:${state.autoDismissMs ?? 0}`;
  },

  describeSurface(state, ctx): string {
    const parts = [ctx.character, state.phase];
    if (state.tone) parts.push(state.tone);
    parts.push(`${state.message.length} chars`);
    if (state.autoDismissMs && state.autoDismissMs > 0) {
      parts.push(`auto ${state.autoDismissMs}ms`);
    }
    return parts.join(' · ');
  },

  // WR-3 (Bundle 7W · 2026-04-20) — scenario replay hook. Fader's
  // tricky bit is the animation controller: the default setState merge
  // would restore `phase` but leave any live tween on the AnimationHandle
  // dangling — so a replay into `fade-in` state would show frozen
  // opacity until the next user event. We cancel the live tween, apply
  // the recorded state, and re-arm the phase-appropriate tween so the
  // fader looks right immediately after scrub.
  replayState(state, ctx): void {
    ctx.animate?.cancel('fader.opacity');
    ctx.setState(state as Partial<typeof state>);
    if (state.phase === 'fade-in') {
      ctx.animate?.tween({
        key: 'fader.opacity',
        durationMs: FADE_MS,
        curve: 'easeOut',
      });
    } else if (state.phase === 'fade-out') {
      ctx.animate?.tween({
        key: 'fader.opacity',
        durationMs: FADE_MS,
        curve: 'easeIn',
      });
    }
    ctx.telemetry?.emit({
      kind: 'fader.replay',
      data: { phase: state.phase, tone: state.tone ?? null },
    });
  },

  configSchema() {
    return {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Banner text rendered inside the fading notice.',
        },
        tone: {
          type: 'string',
          enum: ['info', 'success', 'warning', 'error'],
          description: 'Semantic tone used for the notice color.',
        },
        autoDismissMs: {
          type: 'number',
          description: 'Delay in milliseconds before fade-out starts. 0 keeps it manual.',
        },
      },
      additionalProperties: false,
    };
  },
};

function paintLine(text: string, opacity: number, tone: NonNullable<FaderState['tone']>, width: number): string {
  if (opacity <= 0) return '';
  const clipped = truncate(text, Math.max(0, width - 2));
  // TUI can't do true alpha — approximate opacity buckets as bright /
  // dim / invisible. 3 buckets keep the visual signal unambiguous.
  if (opacity < 0.33) return C.muted(`  ${clipped}`);
  if (opacity < 0.66) return C.subtext(`  ${clipped}`);
  const color = pickColor(tone);
  return `  ${color(clipped)}`;
}

function pickColor(tone: NonNullable<FaderState['tone']>): (s: string) => string {
  switch (tone) {
    case 'success': return C.success;
    case 'warning': return C.warning;
    case 'error':   return C.error;
    case 'info':
    default:        return C.info;
  }
}

function padRight(s: string, w: number): string {
  const vis = visibleWidth(s);
  return vis >= w ? s : s + ' '.repeat(w - vis);
}

export default faderWidget;
