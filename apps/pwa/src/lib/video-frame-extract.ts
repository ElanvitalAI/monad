'use client';

/** R6 Task 4 · §6.3 — Video file → keyframe extraction.
 *
 *  The browser's <video> element + canvas API can decode any
 *  hardware-supported codec without a server round-trip. We seek to
 *  the 1-second mark (or 10% in for very short clips) so the captured
 *  frame is past the typical title card / fade-in.
 *
 *  Returned data URL is PNG so vision-capable LLMs receive a
 *  lossless still; metadata (duration / dimensions / mime) goes into
 *  the `<video_context>` block via the runtime helper. The caller
 *  decides whether to also push the frame onto `attachments[]`.
 *
 *  Errors surface as rejected promises with `code: 'decode' |
 *  'seek' | 'no-frame' | 'unsupported' | 'unavailable'` so the UI can
 *  show a targeted toast. */

export interface ExtractedVideoFrame {
  /** image/png base64 data URL of the keyframe. */
  frameDataUrl: string;
  /** decoded duration of the source clip (seconds). */
  durationSec: number;
  /** keyframe pixel dimensions (matches `videoWidth`/`videoHeight`). */
  widthPx: number;
  heightPx: number;
  /** mime type as the FileList exposed it. */
  mimeType: string;
}

export interface VideoFrameExtractError extends Error {
  code: 'decode' | 'seek' | 'no-frame' | 'unsupported' | 'unavailable';
}

function makeError(
  code: VideoFrameExtractError['code'],
  message: string,
): VideoFrameExtractError {
  const err = new Error(message) as VideoFrameExtractError;
  err.code = code;
  return err;
}

/** Pure helper — pick the seek offset given a clip's duration.
 *  Default is 1.0s; when the clip is shorter than 2 seconds we pick
 *  10% in so we don't try to seek past the end. Exported for tests. */
export function pickSeekOffset(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
  if (durationSec < 2) return Math.max(0.05, durationSec * 0.1);
  return 1;
}

/** Decode the file enough to grab a single keyframe. The function
 *  tears down its temporary <video> element + ObjectURL on every
 *  exit path so a stream of failed attempts doesn't leak memory. */
export async function extractKeyFrame(file: File): Promise<ExtractedVideoFrame> {
  if (typeof window === 'undefined') {
    throw makeError('unavailable', 'extractKeyFrame is browser-only');
  }
  if (!file.type.startsWith('video/')) {
    throw makeError('unsupported', `not a video file: ${file.type || '(unknown)'}`);
  }
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = url;
  video.muted = true;
  video.preload = 'auto';
  video.playsInline = true;
  // Off-screen — never insert into DOM.
  try {
    await new Promise<void>((resolve, reject) => {
      const onError = () => reject(makeError('decode', 'video decode error'));
      video.addEventListener('error', onError, { once: true });
      video.addEventListener('loadedmetadata', () => resolve(), { once: true });
    });
    const offset = pickSeekOffset(video.duration);
    await new Promise<void>((resolve, reject) => {
      const onError = () => reject(makeError('seek', 'video seek error'));
      video.addEventListener('error', onError, { once: true });
      video.addEventListener('seeked', () => resolve(), { once: true });
      try { video.currentTime = offset; }
      catch (e) {
        reject(makeError('seek', e instanceof Error ? e.message : String(e)));
      }
    });
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w === 0 || h === 0) {
      throw makeError('no-frame', 'video has zero dimensions');
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw makeError('decode', 'canvas 2d context unavailable');
    ctx.drawImage(video, 0, 0, w, h);
    const frameDataUrl = canvas.toDataURL('image/png');
    return {
      frameDataUrl,
      durationSec: Number.isFinite(video.duration) ? video.duration : 0,
      widthPx: w,
      heightPx: h,
      mimeType: file.type,
    };
  } finally {
    URL.revokeObjectURL(url);
    // Help the GC — clearing `src` releases the underlying decoder.
    video.removeAttribute('src');
    try { video.load(); } catch { /* ignore */ }
  }
}
