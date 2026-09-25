// PR-S1V.9 (sprint 22 Phase 4) — boot helper + slash command.

import { afterEach, describe, expect, it } from 'bun:test';
import {
  bootDashboardVoiceChat,
  handleVoiceChatSlash,
} from '../src/dashboard/voice-chat/voice-chat-host-boot.js';
import type {
  StreamingSTTOpts,
  StreamingSTTProvider,
} from '../src/voice/streaming-stt/streaming-stt-provider.js';
import type { VoiceChatAudioCapture } from '../src/dashboard/voice-chat/voice-chat-pipeline.js';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL_ENV)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    process.env[k] = v;
  }
});

function buildHarness() {
  const submitted: string[] = [];
  let lastOpts: StreamingSTTOpts | null = null;
  let onDataCb: ((pcm: Buffer) => void) | null = null;
  const provider: StreamingSTTProvider = {
    id: 'openai-realtime-stt',
    format: { sampleRate: 16000, channels: 1, bitsPerSample: 16 },
    async openSession(opts = {}) {
      lastOpts = opts;
      let open = true;
      return {
        pushAudio: () => {},
        finalize: async () => { open = false; opts.onFinal?.('hello world'); },
        abort: async () => { open = false; },
        isOpen: () => open,
      };
    },
  };
  const capture: VoiceChatAudioCapture = {
    async start(onData) { onDataCb = onData; return true; },
    stop() {},
  };
  const result = bootDashboardVoiceChat({
    submitTranscript: (text) => { submitted.push(text); },
    createProvider: async () => provider,
    audioCapture: capture,
  });
  return {
    vchat: result,
    submitted,
    getOpts: () => lastOpts,
    emitData: (pcm: Buffer) => { onDataCb?.(pcm); },
  };
}

describe('bootDashboardVoiceChat — defaults', () => {
  it('resolves provider id from env (default openai-realtime-stt)', () => {
    delete process.env.STREAMING_STT_PROVIDER;
    const { vchat } = buildHarness();
    expect(vchat.providerId).toBe('openai-realtime-stt');
  });

  it('respects STREAMING_STT_PROVIDER env override', () => {
    process.env.STREAMING_STT_PROVIDER = 'gemini-live-stt';
    const { vchat } = buildHarness();
    expect(vchat.providerId).toBe('gemini-live-stt');
  });
});

describe('bootDashboardVoiceChat — flow', () => {
  it('start → finalize submits final transcript and advances controller', async () => {
    const { vchat, submitted } = buildHarness();
    expect(vchat.controller.getPhase()).toBe('inactive');
    const ok = await vchat.pipeline.startListening();
    expect(ok).toBe(true);
    expect(vchat.controller.getPhase()).toBe('listening');
    await vchat.pipeline.finishListening();
    // 2026-04-30 — onFinalTranscript now stops at `processing`.
    // Subsequent transition (`speaking` for auto-submit, `exit` for
    // dictate-only) is the submitTranscript caller's responsibility.
    // Previously the host-boot finally unconditionally transitioned
    // to `speaking`, which falsely lit the HUD speaking indicator
    // even when no LLM call was issued (sticky-less multi-turn).
    expect(submitted).toEqual(['hello world']);
    expect(vchat.controller.getPhase()).toBe('processing');
  });

  it('notifyResponseDone drops speaking back to inactive', async () => {
    const { vchat } = buildHarness();
    await vchat.pipeline.startListening();
    await vchat.pipeline.finishListening();
    // Caller (= dashboard `voiceChatSubmitImpl` in production) is
    // expected to transition to `speaking` when an auto-submit is
    // actually in flight. Simulate that here.
    vchat.controller.transition('speaking');
    expect(vchat.controller.getPhase()).toBe('speaking');
    vchat.notifyResponseDone();
    expect(vchat.controller.getPhase()).toBe('inactive');
  });

  it('handleEsc during listening hard-cancels (matches Alt+R toggle)', async () => {
    // 2026-04-30 — ESC was previously a "commit current transcript"
    // gesture during listening. Per user feedback, ESC now always
    // exits the mode (single key, no need for Alt+R re-press). Server
    // VAD already commits on silence, so manual commit is rarely
    // useful in practice.
    const { vchat, submitted } = buildHarness();
    await vchat.pipeline.startListening();
    const consumed = await vchat.handleEsc();
    expect(consumed).toBe(true);
    expect(vchat.controller.getPhase()).toBe('inactive');
    expect(submitted).toEqual([]); // no commit-via-ESC anymore
  });

  it('handleEsc during speaking cancels and exits', async () => {
    const { vchat } = buildHarness();
    await vchat.pipeline.startListening();
    await vchat.pipeline.finishListening(); // → processing (new design)
    // Simulate the caller's auto-submit transition.
    vchat.controller.transition('speaking');
    expect(vchat.controller.getPhase()).toBe('speaking');
    const consumed = await vchat.handleEsc();
    expect(consumed).toBe(true);
    expect(vchat.controller.getPhase()).toBe('inactive');
  });

  it('handleEsc when inactive returns false', async () => {
    const { vchat } = buildHarness();
    expect(await vchat.handleEsc()).toBe(false);
  });

  it('forwards speaking-phase barge-in to onBargeIn callback', async () => {
    let bargeIns = 0;
    const submitted: string[] = [];
    let onDataCb: ((pcm: Buffer) => void) | null = null;
    const provider: StreamingSTTProvider = {
      id: 'openai-realtime-stt',
      format: { sampleRate: 16000, channels: 1, bitsPerSample: 16 },
      async openSession(opts = {}) {
        let open = true;
        return {
          pushAudio: () => {},
          finalize: async () => { open = false; opts.onFinal?.('hello world'); },
          abort: async () => { open = false; },
          isOpen: () => open,
        };
      },
    };
    const vchat = bootDashboardVoiceChat({
      submitTranscript: (text) => { submitted.push(text); },
      onBargeIn: () => { bargeIns += 1; },
      bargeInVadOpts: {
        threshold: 0.001,
        minSpeechMs: 30,
        silenceMs: 60,
        sampleRate: 16000,
      },
      createProvider: async () => provider,
      audioCapture: {
        async start(onData) { onDataCb = onData; return true; },
        stop() {},
      },
    });
    await vchat.pipeline.startListening();
    vchat.controller.transition('processing');
    vchat.controller.transition('speaking');
    const loudFrame = Buffer.alloc(960);
    for (let i = 0; i < loudFrame.length; i += 2) loudFrame.writeInt16LE(20_000, i);
    onDataCb?.(loudFrame);
    onDataCb?.(loudFrame);
    expect(bargeIns).toBe(1);
    expect(submitted).toEqual([]);
  });
});

describe('handleVoiceChatSlash', () => {
  it('start subcommand begins listening', async () => {
    const { vchat } = buildHarness();
    const msg = await handleVoiceChatSlash(vchat, ['start']);
    expect(msg).toContain('voice-chat started');
    expect(vchat.controller.getPhase()).toBe('listening');
  });

  it('default subcommand is start', async () => {
    const { vchat } = buildHarness();
    const msg = await handleVoiceChatSlash(vchat, []);
    expect(vchat.controller.getPhase()).toBe('listening');
    expect(msg).toContain('voice-chat started');
  });

  it('start while active reports already-active', async () => {
    const { vchat } = buildHarness();
    await handleVoiceChatSlash(vchat, ['start']);
    const msg = await handleVoiceChatSlash(vchat, ['start']);
    expect(msg).toContain('already active');
  });

  it('stop / cancel exits', async () => {
    const { vchat } = buildHarness();
    await handleVoiceChatSlash(vchat, ['start']);
    const msg = await handleVoiceChatSlash(vchat, ['stop']);
    expect(msg).toContain('voice-chat stopped');
    expect(vchat.controller.getPhase()).toBe('inactive');
  });

  it('status reports phase + provider', async () => {
    const { vchat } = buildHarness();
    const msg = await handleVoiceChatSlash(vchat, ['status']);
    expect(msg).toContain('inactive');
    expect(msg).toContain('openai-realtime-stt');
  });

  it('unknown subcommand returns help', async () => {
    const { vchat } = buildHarness();
    const msg = await handleVoiceChatSlash(vchat, ['bogus']);
    expect(msg).toContain('unknown');
    expect(msg).toContain('start/stop/status');
  });
});
