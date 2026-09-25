// Frame protocol — mirrors src/voice/channel-adapters/pwa-voice-adapter.ts
// PWA_VOICE_FRAME_KIND. Kept as a separate file so the frontend can
// reference the same constants without pulling the server-side adapter
// into the browser bundle.

export const PWA_VOICE_FRAME_KIND = {
  UPSTREAM_PCM: 0x01,
  UPSTREAM_FINALIZE: 0x02,
  UPSTREAM_HELLO: 0x03,
  /** Browser → server: BI-1 manual barge-in (Phase D · 2026-05-09).
   *  The user clicked the cut-in button while TTS playback was active.
   *  Server reaction: abort the in-flight STT session (so the next
   *  utterance starts a fresh one) + drop any queued TTS chunks +
   *  let the dispatcher know the current turn was cancelled. Payload
   *  is empty. */
  UPSTREAM_INTERRUPT: 0x04,
  DOWNSTREAM_PCM: 0x81,
  DOWNSTREAM_STATE: 0x82,
  DOWNSTREAM_ERROR: 0x83,
  /** Server → browser: live transcript event (payload = JSON
   *  `{kind: 'partial' | 'final' | 'assistant', text}`). Mirrors
   *  src/voice/channel-adapters/pwa-voice-adapter.ts. Phase 7 §B
   *  shipped this server-side (PR #1262) but the client enum was
   *  never updated; restored here so events surface as transcripts
   *  instead of `unknown frame kind 0x84` errors. */
  DOWNSTREAM_TRANSCRIPT: 0x84,
} as const;

export interface DownstreamTranscript {
  kind: 'partial' | 'final' | 'assistant';
  text: string;
}

export type PwaVoiceFrameKind =
  (typeof PWA_VOICE_FRAME_KIND)[keyof typeof PWA_VOICE_FRAME_KIND];

const HEADER_BYTES = 4;

export function encodeFrame(kind: PwaVoiceFrameKind, payload: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(HEADER_BYTES + payload.byteLength);
  const view = new DataView(buf);
  view.setUint8(0, kind);
  view.setUint8(1, 0);          // flags
  view.setUint16(2, 0, false);  // reserved (BE)
  new Uint8Array(buf, HEADER_BYTES).set(payload);
  return buf;
}

export interface DecodedFrame {
  kind: PwaVoiceFrameKind;
  flags: number;
  payload: Uint8Array;
}

export function decodeFrame(buf: ArrayBuffer): DecodedFrame {
  if (buf.byteLength < HEADER_BYTES) {
    throw new Error(`frame too short (${buf.byteLength} bytes)`);
  }
  const view = new DataView(buf);
  return {
    kind: view.getUint8(0) as PwaVoiceFrameKind,
    flags: view.getUint8(1),
    payload: new Uint8Array(buf, HEADER_BYTES),
  };
}

export function encodeJsonPayload(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj));
}

export function decodeJsonPayload<T>(payload: Uint8Array): T {
  return JSON.parse(new TextDecoder().decode(payload)) as T;
}
