// ── Phase E (Capture Fabric · M1 hero) — M1 × capture-push bridge ──
//
// M1HandoffOrchestrator (already landed) speaks a final utterance via
// `channelSpeak`. For the *hero* scenario we want the final report to
// also include a multi-device capture push (Telegram / Discord / iPad
// Pushcut) — so user gets visual proof + voice/text summary across
// every device.
//
// This bridge composes M1 outcome + capture artifact + Phase D push
// dispatcher into a single final-report function. The M1 orchestrator
// itself is *not modified* — the host calls `dispatchM1FinalReport`
// after `m1.start()` resolves.

import type {
  CapturePushDispatcher,
  CapturePushOutcome,
  CapturePushPayload,
} from '../capture/capture-push.js';
import type { M1Session } from './m1-handoff-orchestrator.js';

export interface M1FinalReportInput {
  /** M1 session that just resolved. */
  readonly session: M1Session;
  /** The voice utterance that was already spoken via `channelSpeak`.
   *  Bridge re-uses this as the push caption (TTS text + visual). */
  readonly utterance: string;
  /** Optional capture artifact (PNG / GIF / asciicast) attached during
   *  the autonomous session — typically the PFC X4 attachment, the
   *  vision-screen-query screenshot, or a final StopPtyRecording
   *  artifact. Null → push omitted (voice-only outcome). */
  readonly artifact: null | {
    readonly bodyBase64: string;
    readonly mimeType: 'image/png' | 'image/gif' | 'video/mp4';
    /** Surface label for the push caption / audit. */
    readonly surfaceLabel?: string;
    /** Wall-clock at capture (defaults to session.startedAt). */
    readonly capturedAt?: number;
  };
}

export interface M1FinalReportOutput {
  readonly sessionId: string;
  readonly artifactPushed: boolean;
  readonly outcomes: readonly CapturePushOutcome[];
}

export interface M1CapturePushBridgeDeps {
  readonly dispatcher: CapturePushDispatcher;
  /** Optional caption builder — defaults to combining utterance +
   *  surface label. */
  readonly buildCaption?: (input: M1FinalReportInput) => string;
  /** Optional sink filter — restrict fanout (e.g. lock-screen mode →
   *  Telegram only). */
  readonly filter?: Parameters<CapturePushDispatcher['push']>[1] extends
    { filter?: infer F } | undefined ? F : never;
  readonly logDebug?: (category: string, event: string, data?: unknown) => void;
}

const MAX_CAPTION_CHARS = 1024;  // Telegram caption cap

function defaultBuildCaption(input: M1FinalReportInput): string {
  const surface = input.artifact?.surfaceLabel ? ` · ${input.artifact.surfaceLabel}` : '';
  const session = ` · session=${input.session.id}`;
  let caption = `[M1] ${input.utterance}${surface}${session}`;
  if (caption.length > MAX_CAPTION_CHARS) {
    caption = caption.slice(0, MAX_CAPTION_CHARS - 1) + '…';
  }
  return caption;
}

/**
 * Fan out the M1 session's final report (utterance + optional capture
 * artifact) to every registered push sink. Returns per-sink outcomes
 * for the host to log / surface / retry.
 *
 * When `artifact` is null, the bridge returns immediately with
 * `artifactPushed: false` — voice-only outcomes don't trigger push
 * fanout (the channelSpeak that M1 already did is enough).
 */
export async function dispatchM1FinalReport(
  input: M1FinalReportInput,
  deps: M1CapturePushBridgeDeps,
): Promise<M1FinalReportOutput> {
  const log = (cat: string, ev: string, data?: unknown): void => {
    if (deps.logDebug) deps.logDebug(cat, ev, data);
  };

  if (!input.artifact) {
    log('m1.capture-push.skip-no-artifact', input.session.id);
    return {
      sessionId: input.session.id,
      artifactPushed: false,
      outcomes: [],
    };
  }

  const buildCaption = deps.buildCaption ?? defaultBuildCaption;
  const caption = buildCaption(input);

  const payload: CapturePushPayload = {
    bodyBase64: input.artifact.bodyBase64,
    mimeType: input.artifact.mimeType,
    caption,
    ...(input.artifact.surfaceLabel !== undefined
      ? { surfaceLabel: input.artifact.surfaceLabel }
      : {}),
    capturedAt: input.artifact.capturedAt ?? Date.parse(input.session.startedAt),
  };

  log('m1.capture-push.fanout', input.session.id, {
    sinkCount: deps.dispatcher.size(),
    captionChars: caption.length,
  });

  const outcomes = await deps.dispatcher.push(
    payload,
    deps.filter ? { filter: deps.filter } : undefined,
  );

  return {
    sessionId: input.session.id,
    artifactPushed: true,
    outcomes,
  };
}
