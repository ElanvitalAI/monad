// Browser → server mic capture. Wraps getUserMedia + AudioWorkletNode
// so we deliver int16 LE 16kHz mono PCM frames matching
// DEFAULT_STREAMING_STT_FORMAT in the server-side adapter.
//
// `echoCancellation: true` enables WebRTC AEC3 — the principal reason
// PWA voice is the right channel for a pure-software echo loop fix
// (the TUI path can't access the browser's AEC).
//
// BI-2 ducking (2026-05-10) — a GainNode sits between the mic
// MediaStreamSource and the worklet so the controller can attenuate
// captured audio while TTS playback is active. With AEC3 already
// applied at the OS layer, the ducking gain compounds on top of the
// detector's `speakingThresholdMultiplier` (raised band) — together
// they move the BI-2 effective margin to ~4× of the quiet baseline.

import { debugLog } from '@/lib/debug';

export interface VoiceCaptureOpts {
  /** Hz — target sample rate the encoded PCM frames carry. STT
   *  expects 16000. The browser AudioContext often runs at 48000;
   *  the worklet downsamples by integer ratio. */
  targetSampleRateHz?: number;
  /** Bytes per upstream frame. ~640 = 320 samples = 20ms @ 16kHz mono
   *  int16 (matches OpenAI realtime expectation). */
  framePcmBytes?: number;
  /** Called for each downsampled int16 LE frame. Backpressure is the
   *  caller's responsibility. */
  onFrame: (pcm: Uint8Array) => void;
  /** Surfaced when getUserMedia / worklet wiring fails. */
  onError?: (err: Error) => void;
}

export interface VoiceCaptureHandle {
  stop(): Promise<void>;
  /** BI-2 ducking — set the mic-input gain multiplier. 1.0 = pass-through
   *  (default while listening), 0.5 = -6dB (default while TTS plays).
   *  Values are clamped to [0, 1]. Applied via Web Audio GainNode so the
   *  attenuation lands on both upstream STT frames AND the RMS detector
   *  feed (the worklet receives the post-gain signal). */
  setMicGain(value: number): void;
}

const DEFAULT_TARGET_HZ = 16000;
const DEFAULT_FRAME_BYTES = 640;

const WORKLET_PROCESSOR_SOURCE = `
class ElanousCaptureProcessor extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    const o = opts.processorOptions || {};
    this.targetHz = o.targetHz | 0 || 16000;
    this.frameBytes = o.frameBytes | 0 || 640;
    // int16 → 2 bytes per sample
    this.frameSamples = this.frameBytes >> 1;
    this.outBuf = new Int16Array(this.frameSamples);
    this.outIdx = 0;
    this.ratio = sampleRate / this.targetHz;
    this.acc = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const ch0 = input[0];
    for (let i = 0; i < ch0.length; i++) {
      this.acc += 1;
      if (this.acc < this.ratio) continue;
      this.acc -= this.ratio;
      const v = Math.max(-1, Math.min(1, ch0[i]));
      this.outBuf[this.outIdx++] = v < 0 ? Math.round(v * 0x8000) : Math.round(v * 0x7fff);
      if (this.outIdx >= this.frameSamples) {
        const copy = new Int16Array(this.outBuf);
        this.port.postMessage(copy.buffer, [copy.buffer]);
        this.outBuf = new Int16Array(this.frameSamples);
        this.outIdx = 0;
      }
    }
    return true;
  }
}
registerProcessor('elanous-capture', ElanousCaptureProcessor);
`;

async function loadWorkletModule(ctx: AudioContext): Promise<void> {
  const blob = new Blob([WORKLET_PROCESSOR_SOURCE], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function startVoiceCapture(opts: VoiceCaptureOpts): Promise<VoiceCaptureHandle> {
  const targetHz = opts.targetSampleRateHz ?? DEFAULT_TARGET_HZ;
  const frameBytes = opts.framePcmBytes ?? DEFAULT_FRAME_BYTES;

  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  let node: AudioWorkletNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let gain: GainNode | null = null;

  debugLog('voice.capture.start', { targetHz, frameBytes });
  try {
    debugLog('voice.capture.gum-request', {
      hasMediaDevices: typeof navigator !== 'undefined' && !!navigator.mediaDevices,
      hasGetUserMedia: typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function',
    });
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
    debugLog('voice.capture.gum-ok', {
      tracks: stream.getTracks().map((t) => ({ kind: t.kind, label: t.label, state: t.readyState })),
    });
    ctx = new AudioContext();
    debugLog('voice.capture.audiocontext', { sampleRate: ctx.sampleRate, state: ctx.state });
    await loadWorkletModule(ctx);
    debugLog('voice.capture.worklet-loaded');
    node = new AudioWorkletNode(ctx, 'elanous-capture', {
      processorOptions: { targetHz, frameBytes },
    });
    node.port.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
      opts.onFrame(new Uint8Array(ev.data));
    };
    source = ctx.createMediaStreamSource(stream);
    gain = ctx.createGain();
    gain.gain.value = 1;
    source.connect(gain);
    gain.connect(node);
    debugLog('voice.capture.wired', { hasGain: true });
    // Don't connect node → ctx.destination — we don't want the
    // mic looping to the speaker.
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    debugLog('voice.capture.error', { name: e.name, message: e.message });
    opts.onError?.(e);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (ctx) await ctx.close();
    throw e;
  }

  let stopped = false;
  return {
    async stop() {
      if (stopped) return;
      stopped = true;
      try { source?.disconnect(); } catch { /* ignore */ }
      try { gain?.disconnect(); } catch { /* ignore */ }
      try { node?.disconnect(); } catch { /* ignore */ }
      try { stream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
      try { await ctx?.close(); } catch { /* ignore */ }
    },
    setMicGain(value: number) {
      if (!gain || !ctx) return;
      const clamped = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
      // setValueAtTime gives a clean step on the audio thread; the
      // 5ms ramp removes the audible click on a hard cut. Both are
      // ~free in the Web Audio scheduler.
      try {
        const now = ctx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(clamped, now + 0.005);
        debugLog('voice.mic.duck.set', { gain: clamped });
      } catch (err) {
        // Older test shims for GainNode may not implement scheduling
        // helpers; fall back to a direct write so jsdom-style mocks
        // can still observe the new value.
        try { gain.gain.value = clamped; } catch { /* ignore */ }
        debugLog('voice.mic.duck.fallback', {
          gain: clamped,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}
