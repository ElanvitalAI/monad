'use client';

/** R6 Task 4 · §6.3 — Audio file → metadata + (optional) STT entry.
 *
 *  Browser Web Speech API does not accept file inputs — it only
 *  consumes live mic input. Practical STT for an uploaded clip
 *  requires either a daemon-side Whisper bridge or an audio-graph
 *  trick whose latency + accuracy is poor.
 *
 *  R6 FU.2 (2026-05-09) — daemon Whisper bridge LANDED. The PWA
 *  flow now: extract metadata locally (synchronous · zero network)
 *  + fire-and-forget daemon STT in parallel. The transcript
 *  populates whenever the daemon call returns; the metadata chip
 *  shows immediately so the UX feels instant. Falls back to the
 *  manual transcript prompt when the daemon call rejects (no STT
 *  configured / network down / file too large). */

export interface ExtractedAudioMeta {
  /** decoded duration in seconds (rounded by caller for display). */
  durationSec: number;
  /** mime/type from the FileList entry. */
  mimeType: string;
  /** size in bytes. */
  sizeBytes: number;
}

export interface AudioMetaExtractError extends Error {
  code: 'decode' | 'unsupported' | 'unavailable';
}

function makeError(
  code: AudioMetaExtractError['code'],
  message: string,
): AudioMetaExtractError {
  const err = new Error(message) as AudioMetaExtractError;
  err.code = code;
  return err;
}

/** Decode just enough of the file to read its duration. Uses the
 *  Web Audio API's `decodeAudioData` (which is in every modern
 *  browser including Safari/iOS via webkitAudioContext shim). */
export async function extractAudioMeta(file: File): Promise<ExtractedAudioMeta> {
  if (typeof window === 'undefined') {
    throw makeError('unavailable', 'extractAudioMeta is browser-only');
  }
  if (!file.type.startsWith('audio/')) {
    throw makeError('unsupported', `not an audio file: ${file.type || '(unknown)'}`);
  }
  const Ctor: typeof globalThis.AudioContext | undefined =
    globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof globalThis.AudioContext }).webkitAudioContext;
  if (!Ctor) {
    throw makeError('unavailable', 'Web Audio API unsupported');
  }
  const ctx = new Ctor();
  try {
    const buf = await file.arrayBuffer();
    const decoded = await ctx.decodeAudioData(buf.slice(0)).catch((e) => {
      throw makeError('decode', e instanceof Error ? e.message : String(e));
    });
    return {
      durationSec: decoded.duration,
      mimeType: file.type,
      sizeBytes: file.size,
    };
  } finally {
    try { await ctx.close(); } catch { /* ignore */ }
  }
}
