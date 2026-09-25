// Server → browser TTS playback. Server sends int16 LE 24kHz mono PCM
// blocks via DOWNSTREAM_PCM frames; we queue them as AudioBufferSource
// nodes so contiguous chunks render seamlessly without gaps.

export interface VoicePlaybackOpts {
  /** Hz — the sample rate the incoming PCM blocks were captured at.
   *  Server-side TTS native rate is 24000. */
  inputSampleRateHz?: number;
  /** Surfaced when playback init fails or a chunk is malformed. */
  onError?: (err: Error) => void;
}

export interface VoicePlaybackHandle {
  enqueue(pcm: Uint8Array): void;
  /** Stop any in-flight buffer + clear the queue. */
  cancel(): void;
  /** Tear down the AudioContext entirely. */
  close(): Promise<void>;
}

const DEFAULT_INPUT_HZ = 24000;

export function createVoicePlayback(opts: VoicePlaybackOpts = {}): VoicePlaybackHandle {
  const inputHz = opts.inputSampleRateHz ?? DEFAULT_INPUT_HZ;
  const ctx = new AudioContext();
  let nextStartAt = 0;
  let liveSources: AudioBufferSourceNode[] = [];

  function enqueue(pcm: Uint8Array): void {
    try {
      // Decode int16 LE → Float32 mono.
      const samples = pcm.byteLength >> 1;
      const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
      const f32 = new Float32Array(samples);
      for (let i = 0; i < samples; i++) {
        const s = view.getInt16(i * 2, true);
        f32[i] = s < 0 ? s / 0x8000 : s / 0x7fff;
      }
      const buffer = ctx.createBuffer(1, samples, inputHz);
      buffer.copyToChannel(f32, 0);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);

      const now = ctx.currentTime;
      const startAt = Math.max(now, nextStartAt);
      source.start(startAt);
      nextStartAt = startAt + buffer.duration;
      liveSources.push(source);
      source.onended = () => {
        liveSources = liveSources.filter((s) => s !== source);
      };
    } catch (err) {
      opts.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  function cancel(): void {
    for (const s of liveSources) {
      try { s.stop(); } catch { /* ignore */ }
      try { s.disconnect(); } catch { /* ignore */ }
    }
    liveSources = [];
    nextStartAt = ctx.currentTime;
  }

  async function close(): Promise<void> {
    cancel();
    try { await ctx.close(); } catch { /* ignore */ }
  }

  return { enqueue, cancel, close };
}
