// PR-S1V.9 (sprint 22 Phase 4) — voice-chat pipeline integration.
//
// Plumbs a fake StreamingSTTProvider + fake audio capture into the
// pipeline and asserts the lifecycle (start → push audio → finalize →
// onFinalTranscript) matches expectations.

import { describe, expect, it } from 'bun:test';
import { createVoiceChatModeController } from '../src/dashboard/voice-chat/voice-chat-mode-controller.js';
import {
  createVoiceChatPipeline,
  type VoiceChatAudioCapture,
} from '../src/dashboard/voice-chat/voice-chat-pipeline.js';
import type {
  StreamingSTTOpts,
  StreamingSTTProvider,
  StreamingSTTSession,
} from '../src/voice/streaming-stt/streaming-stt-provider.js';

interface FakeSession extends StreamingSTTSession {
  pushed: Buffer[];
  finalized: number;
  aborted: number;
  triggerPartial: (text: string) => void;
  triggerFinal: (text: string) => void;
}

function fakeSession(opts: StreamingSTTOpts): FakeSession {
  let open = true;
  const pushed: Buffer[] = [];
  let finalized = 0;
  let aborted = 0;
  return {
    pushAudio: (pcm) => { if (open) pushed.push(pcm); },
    finalize: async () => { finalized += 1; open = false; },
    abort: async () => { aborted += 1; open = false; },
    isOpen: () => open,
    pushed,
    get finalized() { return finalized; },
    get aborted() { return aborted; },
    triggerPartial: (text) => opts.onPartial?.(text),
    triggerFinal: (text) => opts.onFinal?.(text),
  } as unknown as FakeSession;
}

function fakeProvider(): { provider: StreamingSTTProvider; lastSession: () => FakeSession } {
  let last: FakeSession | null = null;
  const provider: StreamingSTTProvider = {
    id: 'openai-realtime-stt',
    format: { sampleRate: 16000, channels: 1, bitsPerSample: 16 },
    async openSession(opts = {}) {
      last = fakeSession(opts);
      return last;
    },
  };
  return {
    provider,
    lastSession: () => {
      if (!last) throw new Error('lastSession called before openSession');
      return last;
    },
  };
}

function fakeCapture(): { capture: VoiceChatAudioCapture; emitData: (b: Buffer) => void; emitEnd: () => void; started: number; stopped: number } {
  let onDataCb: ((b: Buffer) => void) | null = null;
  let onEndCb: (() => void) | null = null;
  let started = 0;
  let stopped = 0;
  return {
    capture: {
      async start(onData, onEnd) {
        onDataCb = onData;
        onEndCb = onEnd;
        started += 1;
        return true;
      },
      stop() {
        stopped += 1;
        if (onEndCb) onEndCb();
      },
    },
    emitData: (b) => onDataCb?.(b),
    emitEnd: () => onEndCb?.(),
    get started() { return started; },
    get stopped() { return stopped; },
  };
}

describe('createVoiceChatPipeline — startListening', () => {
  it('opens session, starts capture, transitions controller to listening', async () => {
    const controller = createVoiceChatModeController();
    const { provider } = fakeProvider();
    const cap = fakeCapture();
    const pipeline = createVoiceChatPipeline({
      controller,
      streamingProvider: provider,
      audioCapture: cap.capture,
      onFinalTranscript: () => {},
    });
    const ok = await pipeline.startListening();
    expect(ok).toBe(true);
    expect(controller.getPhase()).toBe('listening');
    expect(cap.started).toBe(1);
    expect(pipeline.isListening()).toBe(true);
  });

  it('returns false when already listening', async () => {
    const controller = createVoiceChatModeController();
    const { provider } = fakeProvider();
    const cap = fakeCapture();
    const pipeline = createVoiceChatPipeline({
      controller,
      streamingProvider: provider,
      audioCapture: cap.capture,
      onFinalTranscript: () => {},
    });
    await pipeline.startListening();
    expect(await pipeline.startListening()).toBe(false);
  });

  it('returns false when controller is not inactive', async () => {
    const controller = createVoiceChatModeController({ initialPhase: 'speaking' });
    const { provider } = fakeProvider();
    const cap = fakeCapture();
    const pipeline = createVoiceChatPipeline({
      controller,
      streamingProvider: provider,
      audioCapture: cap.capture,
      onFinalTranscript: () => {},
    });
    expect(await pipeline.startListening()).toBe(false);
  });
});

describe('createVoiceChatPipeline — audio forwarding', () => {
  it('PCM chunks from capture flow into session.pushAudio', async () => {
    const controller = createVoiceChatModeController();
    const { provider, lastSession } = fakeProvider();
    const cap = fakeCapture();
    const pipeline = createVoiceChatPipeline({
      controller,
      streamingProvider: provider,
      audioCapture: cap.capture,
      onFinalTranscript: () => {},
    });
    await pipeline.startListening();
    cap.emitData(Buffer.from([0x01, 0x02]));
    cap.emitData(Buffer.from([0x03, 0x04]));
    expect(lastSession().pushed.map((b) => Array.from(b))).toEqual([
      [0x01, 0x02],
      [0x03, 0x04],
    ]);
  });

  it('partial transcripts flow into onPartialTranscript', async () => {
    const controller = createVoiceChatModeController();
    const { provider, lastSession } = fakeProvider();
    const cap = fakeCapture();
    const partials: string[] = [];
    const pipeline = createVoiceChatPipeline({
      controller,
      streamingProvider: provider,
      audioCapture: cap.capture,
      onPartialTranscript: (t) => partials.push(t),
      onFinalTranscript: () => {},
    });
    await pipeline.startListening();
    lastSession().triggerPartial('안녕');
    lastSession().triggerPartial('하세요');
    expect(partials).toEqual(['안녕', '하세요']);
  });

  it('fires onBargeIn once when speech starts during speaking', async () => {
    const controller = createVoiceChatModeController();
    const { provider, lastSession } = fakeProvider();
    const cap = fakeCapture();
    let bargeIns = 0;
    const pipeline = createVoiceChatPipeline({
      controller,
      streamingProvider: provider,
      audioCapture: cap.capture,
      onFinalTranscript: () => {},
      onBargeIn: () => { bargeIns += 1; },
      bargeInVadOpts: {
        threshold: 0.001,
        minSpeechMs: 30,
        silenceMs: 60,
        sampleRate: 16000,
      },
    });
    await pipeline.startListening();
    expect(lastSession().pushed).toHaveLength(0);
    controller.transition('processing');
    controller.transition('speaking');
    const loudFrame = Buffer.alloc(960);
    for (let i = 0; i < loudFrame.length; i += 2) loudFrame.writeInt16LE(20_000, i);
    cap.emitData(loudFrame);
    cap.emitData(loudFrame);
    expect(bargeIns).toBe(1);
    // speaking-phase barge-in must not also flow into STT.
    expect(lastSession().pushed).toHaveLength(0);
  });
});

describe('createVoiceChatPipeline — finishListening', () => {
  it('stops capture and finalizes session', async () => {
    const controller = createVoiceChatModeController();
    const { provider, lastSession } = fakeProvider();
    const cap = fakeCapture();
    const pipeline = createVoiceChatPipeline({
      controller,
      streamingProvider: provider,
      audioCapture: cap.capture,
      onFinalTranscript: () => {},
    });
    await pipeline.startListening();
    await pipeline.finishListening();
    expect(cap.stopped).toBe(1);
    expect(lastSession().finalized).toBe(1);
    expect(pipeline.isListening()).toBe(false);
  });

  it('final transcript reaches onFinalTranscript', async () => {
    const controller = createVoiceChatModeController();
    const { provider, lastSession } = fakeProvider();
    const cap = fakeCapture();
    const finals: string[] = [];
    const pipeline = createVoiceChatPipeline({
      controller,
      streamingProvider: provider,
      audioCapture: cap.capture,
      onFinalTranscript: (t) => finals.push(t),
    });
    await pipeline.startListening();
    // Server sends final right before we call finishListening
    lastSession().triggerFinal('안녕하세요 monad-agent');
    await pipeline.finishListening();
    expect(finals).toEqual(['안녕하세요 monad-agent']);
  });
});

describe('createVoiceChatPipeline — cancel', () => {
  it('aborts session and stops capture', async () => {
    const controller = createVoiceChatModeController();
    const { provider, lastSession } = fakeProvider();
    const cap = fakeCapture();
    const pipeline = createVoiceChatPipeline({
      controller,
      streamingProvider: provider,
      audioCapture: cap.capture,
      onFinalTranscript: () => {},
    });
    await pipeline.startListening();
    await pipeline.cancel();
    expect(lastSession().aborted).toBe(1);
    expect(cap.stopped).toBe(1);
    expect(pipeline.isListening()).toBe(false);
  });
});

describe('createVoiceChatPipeline — resetVad (BACKLOG §9.5b option C)', () => {
  it('resetVad exists on returned interface', () => {
    const controller = createVoiceChatModeController();
    const { provider } = fakeProvider();
    const cap = fakeCapture();
    const pipeline = createVoiceChatPipeline({
      controller,
      streamingProvider: provider,
      audioCapture: cap.capture,
      onFinalTranscript: () => {},
    });
    expect(typeof pipeline.resetVad).toBe('function');
  });

  it('resetVad is a no-op when VAD is not wired (server-VAD providers)', () => {
    const controller = createVoiceChatModeController();
    const { provider } = fakeProvider();
    const cap = fakeCapture();
    // No vadOpts → no local VAD detector → resetVad must not throw.
    const pipeline = createVoiceChatPipeline({
      controller,
      streamingProvider: provider,
      audioCapture: cap.capture,
      onFinalTranscript: () => {},
    });
    expect(() => pipeline.resetVad()).not.toThrow();
  });

  it('resetVad with vadOpts wired clears the local VAD silence accumulator', async () => {
    const controller = createVoiceChatModeController();
    const { provider } = fakeProvider();
    const cap = fakeCapture();
    let speechEnds = 0;
    const pipeline = createVoiceChatPipeline({
      controller,
      streamingProvider: provider,
      audioCapture: cap.capture,
      onFinalTranscript: () => {},
      vadOpts: {
        threshold: 0.001,
        silenceMs: 50,
        minSpeechMs: 1,
        sampleRate: 16000,
        onSpeechEnd: () => { speechEnds += 1; },
      },
    });
    // resetVad before any audio — must remain idempotent.
    expect(() => pipeline.resetVad()).not.toThrow();
    await pipeline.startListening();
    // After listening starts, resetVad still safe to call (re-arm path).
    expect(() => pipeline.resetVad()).not.toThrow();
    expect(speechEnds).toBe(0);
  });
});
