// Phase 2 of Step 2 plain dispatch extraction
// (BACKLOG-voice-chat-multi-turn-plain-dispatch-extract §1-§7).
//
// The full `runDashboardChatMainPlainTurn(text, deps)` extract is a
// 2-day refactor — this file lands the smallest self-contained
// sub-piece first as a stepping stone: the **settle sink** that fires
// in the plain dispatch's `finally` block.
//
// Settle sink responsibilities (from `src/dashboard/index.ts` plain
// dispatch path, post PR #1205 echo loop A+C fix):
//
//   1. Await `autoTts.commit()` (settled=end_turn) or
//      `autoTts.cancel()` (settled=error|cancelled). Drains the OS
//      audio queue.
//   2. Sleep `cooldownMs` (BACKLOG §9.5b A) so `speaking → listening`
//      doesn't race the TTS playback tail.
//   3. Invoke `notifyResponseDone()` so the voice-chat controller
//      flips to listening (multi-turn) or inactive.
//
// Mirrors `src/dashboard/input/chat-main-acp-dispatch.ts` 's onDone +
// onError sink. Both paths now share the same structural shape:
// commit/cancel → cooldown → onTurnDone.
//
// This file is a pure async IIFE runner — fire-and-forget. The caller
// (the plain dispatch's `finally`) `void`-s the returned Promise.

import type { ControlSignalBus, ControlSignalScope } from '../../input/control-signal.js';
import {
  createTurnOutputBundle,
  runTurnOutputBundleSettle,
} from '../../input/turn-output-bundle.js';
import { debug } from '../../debug/log.js';

export type DashboardPlainTurnSettleReason = 'end_turn' | 'error' | 'cancelled';

export interface DashboardPlainTurnSettleSinkDeps {
  /** Reason captured at the top of the dispatch's `finally`. */
  settled: DashboardPlainTurnSettleReason;
  /** Total assistant text length (for debug log only). */
  accumulatedChars: number;
  /** ms to sleep between commit/cancel and notifyResponseDone.
   *  Resolved from `voice.tts.drainCooldownMs` user-config. */
  cooldownMs: number;
  /** Awaited on `settled === 'end_turn'`. Drains the audio sink so
   *  the `speaking → listening` flip happens after playback. */
  commit: () => void | Promise<void>;
  /** Awaited on `settled === 'error' | 'cancelled'`. */
  cancel: () => void | Promise<void>;
  /** Invoked after the cooldown — flips voice-chat controller out of
   *  speaking. */
  notifyResponseDone: () => void;
  /** Optional pre-settle revision gate. When a matching recent
   *  quick-pass exists we downgrade end_turn to cancel before any
   *  TTS playback starts. */
  preSettleQuickPass?: {
    signalBus: ControlSignalBus;
    scope: ControlSignalScope;
    windowMs?: number;
    signalKinds?: readonly string[];
  };
}

/**
 * Run the plain dispatch settle sink. Fire-and-forget — caller
 * `void`-s the returned Promise so the dispatch's `finally` doesn't
 * block on the cooldown.
 *
 * Errors from commit/cancel/notifyResponseDone are isolated via debug
 * log (matches the inline behaviour pre-extract). The cooldown sleep
 * always runs regardless of commit/cancel exceptions so the controller
 * flip is consistent.
 */
export async function runDashboardPlainTurnSettleSink(
  deps: DashboardPlainTurnSettleSinkDeps,
): Promise<void> {
  if (debug.enabled && deps.settled === 'end_turn') {
    debug.log('voice.auto-tts', 'dispatch.commit.begin.plain', {
      accumulated: deps.accumulatedChars,
    });
  }
  await runTurnOutputBundleSettle({
    bundle: createTurnOutputBundle([
      {
        kind: 'audio-tts',
        lifecycle: 'segment-stream-then-drain',
        onEndTurn: deps.commit,
        onCancel: deps.cancel,
      },
    ]),
    settled: deps.settled,
    cooldownMs: deps.cooldownMs,
    notifyDone: () => deps.notifyResponseDone(),
    debugPath: 'plain',
    ...(deps.preSettleQuickPass ? { preSettleQuickPass: deps.preSettleQuickPass } : {}),
  });
}
