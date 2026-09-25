// PR-S1V.12 (sprint 22 Phase 6 wire · 2026-04-30) — PCM resampling
// helpers for the Discord voice channel adapter.
//
// Discord's voice gateway transports Opus at 48 kHz / stereo. monad's
// streaming-stt expects 16 kHz mono (Phase 3 contract); auto-tts emits
// 24 kHz mono (Phase 1 contract). Two conversions are needed:
//
//   inbound:  48k stereo PCM (from prism-media OpusDecoder)
//             → 16k mono PCM (push to streaming-stt session)
//
//   outbound: 24k mono PCM (TTS provider output)
//             → 48k stereo PCM (feed to prism-media OpusEncoder)
//
// Both directions use simple integer-ratio decimation/interpolation
// + naïve channel mix. No anti-aliasing low-pass filter — voice
// content sits well below Nyquist for these ratios so the audible
// artifacts are minimal. Upgrade path: swap in `prism-media`'s
// `FFmpeg` transformer if quality needs improvement.

import { Buffer } from 'node:buffer';

/** Convert 48 kHz stereo (interleaved int16 LE) → 16 kHz mono. */
export function pcm48kStereoTo16kMono(input: Buffer): Buffer {
  // 48k stereo: 2 channels × 2 bytes per sample = 4 bytes / frame
  // 16k mono:   1 channel  × 2 bytes per sample = 2 bytes / frame
  // Decimation: 3 input frames → 1 output frame (48/16 = 3:1)
  // Channel mix: average L+R per input frame.
  if (input.length < 4) return Buffer.alloc(0);
  const inFrames = Math.floor(input.length / 4);
  const outFrames = Math.floor(inFrames / 3);
  const out = Buffer.alloc(outFrames * 2);
  for (let i = 0; i < outFrames; i++) {
    // Box-average the full 3-frame window (L+R × 3 = 6 samples).
    // Nearest-neighbour (pick frame 0, skip 2) aliased everything
    // above 8 kHz down into the speech band and measurably hurt STT
    // accuracy (M4c dogfood 2026-07-12 "인식이 매우 안좋음"). The box
    // filter is a crude low-pass but kills the worst of the aliasing
    // at ~zero cost.
    const base = i * 3 * 4;
    let sum = 0;
    for (let f = 0; f < 3; f++) {
      sum += input.readInt16LE(base + f * 4);
      sum += input.readInt16LE(base + f * 4 + 2);
    }
    const mono = Math.max(-32768, Math.min(32767, Math.round(sum / 6)));
    out.writeInt16LE(mono, i * 2);
  }
  return out;
}

/** Convert 24 kHz mono PCM → 16 kHz mono (3:2 decimation with a light
 *  box blend). Used to feed the bot's own TTS output into the echo
 *  classifier's reference window at the inbound 16 kHz contract. */
export function pcm24kMonoTo16kMono(input: Buffer): Buffer {
  const inSamples = Math.floor(input.length / 2);
  const groups = Math.floor(inSamples / 3);
  const out = Buffer.alloc(groups * 2 * 2);
  for (let g = 0; g < groups; g++) {
    const a = input.readInt16LE(g * 6);
    const b = input.readInt16LE(g * 6 + 2);
    const c = input.readInt16LE(g * 6 + 4);
    out.writeInt16LE(a, g * 4);
    out.writeInt16LE(Math.max(-32768, Math.min(32767, (b + c) >> 1)), g * 4 + 2);
  }
  return out;
}

/** Convert 16 kHz mono PCM → 24 kHz mono (2:3 선형보간).
 *
 *  디스코드 인바운드 계약(16k)을 openai-realtime-stt 의 24 kHz 세션에
 *  맞추는 업샘플러 (2026-07-12 실측): 16k 를 rate=24000 세션에 그대로
 *  밀면 서버가 1.5배 빨리감기로 해석해 핵심 어휘가 깨진다 ("스냅샷인지
 *  델타인지" → "쓰립시하신지 데이터인지"). 업샘플 후엔 동일 음성이
 *  완벽 전사. M4c "openai 인식 매우 안좋음"의 잔존 원인 — scribe 신설로
 *  우회만 되고 이 구간은 방치돼 있었다. */
export function pcm16kMonoTo24kMono(input: Buffer): Buffer {
  const inSamples = Math.floor(input.length / 2);
  const pairs = Math.floor(inSamples / 2);
  if (pairs === 0) return Buffer.alloc(0);
  const out = Buffer.alloc(pairs * 3 * 2);
  for (let p = 0; p < pairs; p++) {
    const a = input.readInt16LE(p * 4);
    const b = input.readInt16LE(p * 4 + 2);
    out.writeInt16LE(a, p * 6);
    out.writeInt16LE(Math.round((a + b) / 2), p * 6 + 2);
    out.writeInt16LE(b, p * 6 + 4);
  }
  return out;
}

/** Convert 24 kHz mono PCM (int16 LE) → 48 kHz stereo. */
export function pcm24kMonoTo48kStereo(input: Buffer): Buffer {
  // 24k mono:   1 channel  × 2 bytes per sample = 2 bytes / frame
  // 48k stereo: 2 channels × 2 bytes per sample = 4 bytes / frame
  // Interpolation: 1 input frame → 2 output frames (48/24 = 2:1)
  // Each output frame writes the same mono sample to L and R.
  if (input.length < 2) return Buffer.alloc(0);
  const inFrames = Math.floor(input.length / 2);
  const out = Buffer.alloc(inFrames * 2 * 4);
  for (let i = 0; i < inFrames; i++) {
    const sample = input.readInt16LE(i * 2);
    const outBase = i * 2 * 4;
    // First copy: original sample.
    out.writeInt16LE(sample, outBase);
    out.writeInt16LE(sample, outBase + 2);
    // Second copy: same sample (zero-order hold). Linear interpolation
    // would be marginally smoother but adds work; the artifact at the
    // 24 kHz Nyquist is inaudible for speech.
    out.writeInt16LE(sample, outBase + 4);
    out.writeInt16LE(sample, outBase + 6);
  }
  return out;
}
