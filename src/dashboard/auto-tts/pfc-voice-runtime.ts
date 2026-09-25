// ── V1 (Phase 1 Bundle 2) — PFC voice TTS report ──
//
// Bridges T1's `PfcReverseFeedbackNotification` to the auto-TTS
// sentence streamer. When PFC has something to say (shell death +
// classifier verdict), the same summary that lands in the chat log
// also flows out as a spoken sentence — so the user can keep hands
// on keyboard / eyes on stack trace.
//
// HANDOFF §5 V1: "T1 의 PFC analysis 결과를 auto-TTS sentence streamer
// 로 보냄". Per §6 (V1 hint) we reuse the existing
// `AutoTtsController.pushChunk + commit` instead of building a
// separate audio path; this guarantees voice reports honor the same
// global enable / cancel surface as turn-stream TTS.
//
// Opt-in via `MONAD_PFC_VOICE_REPORT=1` (default off — voice surfaces
// in TUI are still relatively new and silent-by-default avoids
// startling on first dogfood).

import type { PfcReverseFeedbackNotification } from '../../conductor/pfc-reverse-feedback.js';
import { describeCapability } from '../../voice/capability-naming.js';
import type { AutoTtsController } from './auto-tts-controller.js';

export interface PfcVoiceRuntimeDeps {
  /** Late-bound controller accessor — auto-tts boots after PFC, so
   *  the runtime calls this lazily on each notification. Returning
   *  `null` skips voice (chat-line still fires). */
  getController: () => AutoTtsController | null;
  /** Initial enabled state. Driven by `MONAD_PFC_VOICE_REPORT=1` at
   *  boot. Default `false`. */
  initiallyEnabled?: boolean;
  logDebug?: (category: string, event: string, data?: unknown) => void;
  /** Synthesis hook — the sentence sent to TTS. Default
   *  `(summary) => summary`. Override to localise / strip emoji /
   *  rephrase for spoken delivery (chat lines use 🧠 emoji etc.). */
  composeUtterance?: (notification: PfcReverseFeedbackNotification) => string;
}

export interface PfcVoiceRuntime {
  isEnabled(): boolean;
  enable(): void;
  disable(): void;
  toggle(): boolean;
  /** Sink for PFC notifications. Wire as the dashboard PFC feedback
   *  runtime's `onNotification`. */
  onNotification(notification: PfcReverseFeedbackNotification): void;
}

/** Default utterance: strip emoji + apply card-ish rephrasing so the
 *  spoken form reads naturally. Per V3 (Bundle 1) the capability gate
 *  hint pulls from `describeCapability` so users hear *why* an Apply
 *  is unavailable instead of the bare "읽기 전용" label. */
function defaultCompose(notification: PfcReverseFeedbackNotification): string {
  const { research, canApply, capability } = notification;
  const top = research.candidates[0];
  const cls = research.classification.clazz;
  const exit = research.classification.exitCode;
  const exitFragment = exit !== undefined ? `종료 코드 ${exit}` : '';
  const headline = top?.label ?? 'shell이 종료됐습니다';
  const applyHint = canApply
    ? '제안을 적용하려면 [Apply]를 누르세요.'
    // V3 — capability 자연어 표현. exposure 정보가 notification 에 직접
    // 없으므로 capability 만으로 reasonable 추정 (canWrite=false 면 최소
    // observe-only 또는 더 약함).
    : describeCapability({
        exposure: capability.canRead
          ? { userExposure: 'observe-only', agentInteractive: true }
          : { userExposure: 'unavailable', agentInteractive: false },
        capability,
      });
  switch (cls) {
    case 'timeout':
      return `명령이 타임아웃됐습니다. ${headline}. ${applyHint}`;
    case 'killed':
      return `명령이 중단됐습니다. ${headline}. ${applyHint}`;
    case 'error-with-trace':
      return `에러가 발견됐습니다. ${exitFragment}. ${headline}. ${applyHint}`;
    case 'silent-nonzero':
      return `명령이 ${exitFragment}로 조용히 실패했습니다. ${applyHint}`;
    default:
      return `${headline}.`;
  }
}

export function createPfcVoiceRuntime(deps: PfcVoiceRuntimeDeps): PfcVoiceRuntime {
  let enabled = deps.initiallyEnabled ?? false;
  const compose = deps.composeUtterance ?? defaultCompose;

  return {
    isEnabled: () => enabled,
    enable() {
      enabled = true;
      if (deps.logDebug) deps.logDebug('pfc.voice.enable', 'on');
    },
    disable() {
      enabled = false;
      if (deps.logDebug) deps.logDebug('pfc.voice.disable', 'off');
    },
    toggle() {
      enabled = !enabled;
      if (deps.logDebug) deps.logDebug('pfc.voice.toggle', enabled ? 'on' : 'off');
      return enabled;
    },
    onNotification(notification) {
      if (!enabled) return;
      const controller = deps.getController();
      if (!controller) {
        if (deps.logDebug) deps.logDebug('pfc.voice.no-controller', notification.shellId);
        return;
      }
      const utterance = compose(notification);
      if (!utterance.trim()) return;
      try {
        controller.pushChunk(utterance);
        // commit() drains the speak queue — fire-and-forget so the
        // notification sink stays sync.
        void controller.commit().catch((err) => {
          if (deps.logDebug) {
            deps.logDebug('pfc.voice.commit-throw', notification.shellId, {
              error: String(err),
            });
          }
        });
        if (deps.logDebug) {
          deps.logDebug('pfc.voice.spoken', notification.shellId, {
            chars: utterance.length,
            clazz: notification.research.classification.clazz,
          });
        }
      } catch (err) {
        if (deps.logDebug) {
          deps.logDebug('pfc.voice.push-throw', notification.shellId, {
            error: String(err),
          });
        }
      }
    },
  };
}
