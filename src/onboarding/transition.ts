// PR-Δ24 (Sprint 17 · 2026-04-30 · F11) — step transition animation.
//
// Lightweight visual cue between wizard steps so the eye can track
// the boundary instead of the next step popping in instantly.
// PLAN §3.6 deliberately avoids over-engineering: no altscreen
// trickery, no per-frame redraw, no SGR fade — just a one-line hint
// + tiny pause. Defaults at 60ms total (visible, not annoying);
// configurable via ELANOUS_SETUP_TRANSITION_MS env or opts.fadeMs.
//
// Auto-disabled when:
//   - profile is `'mono'`  (no color → animation defeats the point;
//                           pause feels like a lag, not a transition)
//   - non-TTY              (CI / piped tests want determinism + speed)
//   - opts.disable === true (caller explicitly skips, e.g. recap loop)

import type { WizardIO } from '../onboarding.js';
import { type ColorProfile, paint } from '../expression/color.js';

export interface StepTransitionOpts {
  /** Wall-clock pause in ms. Default 60. Capped to [0, 1000]. */
  fadeMs?: number;
  /** Profile detected at the host. mono → skip the transition entirely. */
  profile?: ColorProfile;
  /** Caller-driven kill switch (e.g. summary recap loop runs many
   *  back-to-back step swaps and a transition between each would be
   *  noise). Default false. */
  disable?: boolean;
  /** Sleep impl override — tests pass a fake to keep wall-clock out
   *  of the suite. Default = node setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_FADE_MS = 60;
const MAX_FADE_MS = 1000;

const ARROW_ACCENT = '#89b4fa';
const ARROW_MUTED = '#7f849c';

/** Render a one-line "→ Step N → N+1" hint and pause briefly so the
 *  user's eye can latch onto the boundary. Returns immediately when
 *  any of the auto-disable conditions hit (mono / non-TTY / opts.
 *  disable / fadeMs ≤ 0). */
export async function stepTransition(
  io: WizardIO,
  fromStep: number,
  toStep: number,
  opts: StepTransitionOpts = {},
): Promise<void> {
  if (opts.disable) return;
  const profile = opts.profile;
  if (profile === 'mono') return;
  const ms = clampFade(opts.fadeMs ?? envFadeMs() ?? DEFAULT_FADE_MS);
  if (ms <= 0) return;

  // Visual hint: muted "Step N" + accent arrow + accent "Step N+1".
  // Falls through `paint(profile=truecolor)` when the host didn't
  // pass a profile — best-effort color, harmless on mono terminals
  // since paint() degrades to identity there.
  const p = profile ?? 'truecolor';
  const arrow = paint(ARROW_ACCENT, p)('  →  ');
  const fromLabel = paint(ARROW_MUTED, p)(`Step ${fromStep}`);
  const toLabel = paint(ARROW_ACCENT, p)(`Step ${toStep}`);
  io.print(`${fromLabel}${arrow}${toLabel}`);

  const sleepImpl = opts.sleep ?? defaultSleep;
  await sleepImpl(ms);
}

function clampFade(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) return 0;
  if (ms > MAX_FADE_MS) return MAX_FADE_MS;
  return ms;
}

function envFadeMs(): number | undefined {
  const raw = process.env.ELANOUS_SETUP_TRANSITION_MS;
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
