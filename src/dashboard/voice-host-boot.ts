import { debug } from '../debug/log.js';
import type { DashboardVoiceRuntime } from './voice-runtime.js';
import type { SpaceLongPressDetector } from './input/space-longpress-detector.js';
import type { VoiceInputHost, VoiceIndicator } from './voice-input-host.js';
import type { STTProvider } from '../voice/stt-provider.js';

export interface BootDashboardVoiceHostDeps {
  voiceRuntime: DashboardVoiceRuntime;
  createSttProvider: () => Promise<STTProvider>;
  createVoiceInputHost: (deps: {
    sttProvider: STTProvider;
    resolveSession: DashboardVoiceRuntime['resolveSession'];
    submitToSession: DashboardVoiceRuntime['submitToSession'];
    dictateTranscript: DashboardVoiceRuntime['dictateTranscript'];
  }) => VoiceInputHost;
  createLongPressDetector: (deps: {
    onPressFirst: () => void;
    onLongPress: () => void;
    onLongRelease: () => void;
    onTap: () => void;
  }) => SpaceLongPressDetector;
  onIndicatorChange: (label: string | null) => void;
  requestRender: () => void;
  /** PR-S1V.D5+ smoothness — pre-shift focus to chat-main input pane
   *  synchronously with the long-press release event. The dashboard
   *  passes a closure that knows `workingDir.focus` and the focus-
   *  transition apply API; the boot module just calls it before
   *  `host.stopDictation()`. Without this, focus jumps to input only
   *  after STT completes (1-1.5 s), giving a jarring "stutter" at
   *  the end of dictation. Skipped (no-op) when chord toggle was
   *  used from inside chat-main — caller decides. */
  onLongReleasePreShiftFocus?: () => void;
}

export interface BootDashboardVoiceHostResult {
  host: VoiceInputHost;
  detector: SpaceLongPressDetector;
  unsubscribeIndicator: () => void;
}

export async function bootDashboardVoiceHost(
  deps: BootDashboardVoiceHostDeps,
): Promise<BootDashboardVoiceHostResult> {
  const sttProvider = await deps.createSttProvider();
  const host = deps.createVoiceInputHost({
    sttProvider,
    resolveSession: deps.voiceRuntime.resolveSession,
    submitToSession: deps.voiceRuntime.submitToSession,
    dictateTranscript: deps.voiceRuntime.dictateTranscript,
  });
  const unsubscribeIndicator = host.onIndicatorChange((ind: VoiceIndicator) => {
    deps.onIndicatorChange(ind.visible ? (ind.label ?? '🎙') : null);
    deps.requestRender();
  });
  const detector = deps.createLongPressDetector({
    onPressFirst: () => {
      // PR-S1V.D5+ smoothness — emit a "🎤 hold…" HUD indicator the
      // moment the detector enters the pending phase, so the user
      // gets immediate feedback that their press registered (well
      // before the threshold commits to recording at ~600 ms). No-op
      // when voice mode or an active dictation already owns the
      // indicator (host.notePending guards that).
      host.notePending();
    },
    onLongPress: () => {
      const ok = host.startDictation();
      if (debug.enabled) {
        debug.log('voice.dictation', 'longpress.fire', { started: ok });
      }
    },
    onLongRelease: () => {
      // PR-S1V.D5+ smoothness — pre-shift focus before STT runs so
      // the user sees the transition land synchronously with the
      // release. The 1-1.5 s STT latency that follows is then
      // visible as a "✨ Transcribing" indicator over an already-
      // focused chat input, instead of jolting focus only after
      // STT completes. The caller's closure decides whether the
      // shift applies (skipped when focus is already in input).
      deps.onLongReleasePreShiftFocus?.();
      void host.stopDictation();
    },
    onTap: () => {
      // Ordinary Space tap — clear the "🎤 hold…" pending indicator
      // so it doesn't linger after a sub-threshold tap.
      host.clearPending();
    },
  });
  if (debug.enabled) {
    debug.log('voice.host', 'boot.ready', { provider: sttProvider.id });
  }
  return {
    host,
    detector,
    unsubscribeIndicator,
  };
}

export function reportDashboardVoiceBootError(
  error: unknown,
): string {
  if (debug.enabled) {
    debug.log('voice.host', 'boot.error', {
      err: error instanceof Error ? error.message : String(error),
    }, { level: 'error' });
  }
  return `  voice mode disabled — STTProvider boot failed: ${
    error instanceof Error ? error.message : String(error)
  }`;
}
