// PR-S1V.9 (sprint 22 Phase 4 · 2026-04-29) — Voice-chat mode state
// machine.
//
// `inactive` ──enter──→ `listening`
// `listening` ──finalize/ESC──→ `processing`
// `processing` ──submit done──→ `speaking`
// `speaking` ──response done──→ `inactive` (1-turn) or back to `listening`
// (multi-turn, Phase 5 VAD)
// any state ──exit(reason)──→ `inactive`
//
// The controller owns *only* the phase transitions and observers.
// Audio capture / STT session / TTS / submit are wired by the pipeline
// (PR-S1V.9 voice-chat-pipeline.ts) — that separation lets tests
// exercise the state machine without spinning up subprocesses.
//
// Reference: ROADMAP §5.1.

import { debug } from '../../debug/log.js';

// ── Types ──────────────────────────────────────────────────────────

export type VoiceChatPhase =
  | 'inactive'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'stopping';

export type VoiceChatExitReason =
  | 'user-cancel'
  | 'completion-1-turn'
  | 'error'
  | 'mutex-conflict';

export interface VoiceChatModeController {
  enter(): boolean;
  exit(reason: VoiceChatExitReason): void;
  getPhase(): VoiceChatPhase;
  /** Internal helper for the pipeline — returns previous phase on
   *  successful transition, or null when the transition isn't valid. */
  transition(next: VoiceChatPhase): VoiceChatPhase | null;
  onPhaseChange(cb: (next: VoiceChatPhase, prev: VoiceChatPhase) => void): () => void;
  isActive(): boolean;
}

export interface VoiceChatModeControllerOpts {
  /** Initial phase — defaults to `inactive`. Tests inject mid-state. */
  initialPhase?: VoiceChatPhase;
  /** Hook fired on every transition with (next, prev). Boot wires this
   *  to the dashboard status bar / debug log. */
  onPhaseChange?: (next: VoiceChatPhase, prev: VoiceChatPhase) => void;
}

// ── Allowed transitions ────────────────────────────────────────────

const ALLOWED: Record<VoiceChatPhase, ReadonlySet<VoiceChatPhase>> = {
  inactive: new Set(['listening']),
  listening: new Set(['processing', 'stopping']),
  processing: new Set(['speaking', 'stopping']),
  speaking: new Set(['listening', 'inactive', 'stopping']),
  stopping: new Set(['inactive']),
};

// ── Implementation ─────────────────────────────────────────────────

export function createVoiceChatModeController(
  opts: VoiceChatModeControllerOpts = {},
): VoiceChatModeController {
  let phase: VoiceChatPhase = opts.initialPhase ?? 'inactive';
  const subscribers = new Set<(next: VoiceChatPhase, prev: VoiceChatPhase) => void>();
  if (opts.onPhaseChange) subscribers.add(opts.onPhaseChange);

  function emit(next: VoiceChatPhase, prev: VoiceChatPhase): void {
    if (debug.enabled)
      debug.log('voice.chat.phase', 'transition', { prev, next });
    for (const cb of subscribers) {
      try { cb(next, prev); } catch (err) {
        if (debug.enabled)
          debug.log('voice.chat.phase', 'subscriber-error', { err: String(err) }, { level: 'error' });
      }
    }
  }

  function transition(next: VoiceChatPhase): VoiceChatPhase | null {
    if (next === phase) return phase;
    const allowedNext = ALLOWED[phase];
    if (!allowedNext.has(next)) {
      if (debug.enabled)
        debug.log('voice.chat.phase', 'transition.rejected', {
          prev: phase, next, allowed: Array.from(allowedNext),
        });
      return null;
    }
    const prev = phase;
    phase = next;
    emit(next, prev);
    return prev;
  }

  function enter(): boolean {
    return transition('listening') !== null;
  }

  function exit(reason: VoiceChatExitReason): void {
    if (phase === 'inactive') return;
    if (debug.enabled)
      debug.log('voice.chat.phase', 'exit', { from: phase, reason });
    if (phase !== 'stopping') {
      // Force into stopping → inactive chain regardless of strict
      // transitions, since exit() is the explicit kill switch.
      const prev1 = phase;
      phase = 'stopping';
      emit('stopping', prev1);
    }
    const prev2 = phase;
    phase = 'inactive';
    emit('inactive', prev2);
  }

  return {
    enter,
    exit,
    getPhase: () => phase,
    transition,
    onPhaseChange: (cb) => {
      subscribers.add(cb);
      return () => { subscribers.delete(cb); };
    },
    isActive: () => phase !== 'inactive',
  };
}

/** Human-readable phase label for status indicators. Centralized so
 *  the dashboard status bar / toast / debug log all match. */
export function describeVoiceChatPhase(phase: VoiceChatPhase): string {
  switch (phase) {
    case 'inactive':
      return '';
    case 'listening':
      return '🎙 listening — speak, then ESC to send';
    case 'processing':
      return '⚙ processing — sending to elanous';
    case 'speaking':
      return '🔊 speaking — assistant responding';
    case 'stopping':
      return '↺ stopping';
  }
}
