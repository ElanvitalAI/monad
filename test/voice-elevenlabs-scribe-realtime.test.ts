// M4c follow-up (2026-07-12) — ElevenLabs Scribe v2 Realtime STT
// provider tests. Fake WebSocket (with readyState, which the provider
// checks before send) verifies: URL/query construction, chunk send
// shape, partial/committed event mapping, manual-commit finalize
// handshake, and error surfacing.

import { afterEach, describe, expect, it } from 'bun:test';
import { Buffer } from 'node:buffer';
import {
  createVoiceCostTracker,
  setGlobalVoiceCostTrackerForTesting,
} from '../src/voice/cost-tracker.js';
import { ElevenLabsScribeRealtimeProvider } from '../src/voice/streaming-stt/streaming-stt-providers/elevenlabs-scribe-realtime.js';
import {
  createStreamingSTTProvider,
  resolveStreamingSTTProviderIdFromEnv,
} from '../src/voice/streaming-stt/streaming-stt-provider.js';

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL_ENV)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) process.env[k] = v;
});

interface FakeWS {
  url: string;
  opts: unknown;
  sent: string[];
  closed: boolean;
  triggerOpen(): void;
  triggerMessage(data: string): void;
  triggerClose(): void;
}

function makeFakeWebSocketCtor(): { ctor: typeof WebSocket; latest: () => FakeWS } {
  let last: FakeWS | null = null;
  class Fake {
    url: string;
    opts: unknown;
    sent: string[] = [];
    closed = false;
    readyState = 0; // CONNECTING
    private listeners: Record<string, Array<(ev: unknown) => void>> = {};
    constructor(url: string, opts?: unknown) {
      this.url = url;
      this.opts = opts;
      const self = this;
      last = {
        url,
        opts,
        sent: this.sent,
        get closed() { return self.closed; },
        triggerOpen: () => { self.readyState = 1; self.dispatch('open', {}); },
        triggerMessage: (data: string) => self.dispatch('message', { data }),
        triggerClose: () => { self.close(); },
      } as FakeWS;
    }
    addEventListener(event: string, cb: (ev: unknown) => void): void {
      (this.listeners[event] ??= []).push(cb);
    }
    send(data: string): void { this.sent.push(data); }
    close(): void {
      if (this.closed) return;
      this.closed = true;
      this.readyState = 3;
      this.dispatch('close', {});
    }
    private dispatch(event: string, ev: unknown): void {
      for (const cb of (this.listeners[event] ?? []).slice()) cb(ev);
    }
  }
  return {
    ctor: Fake as unknown as typeof WebSocket,
    latest: () => {
      if (!last) throw new Error('FakeWS.latest called before any constructor');
      return last;
    },
  };
}

function makeProvider(fake: { ctor: typeof WebSocket }): ElevenLabsScribeRealtimeProvider {
  return new ElevenLabsScribeRealtimeProvider({
    id: 'elevenlabs-scribe-realtime',
    apiKey: 'xi-test-key',
    WebSocketCtor: fake.ctor,
  });
}

describe('ElevenLabsScribeRealtimeProvider', () => {
  it('throws unavailable without an API key', () => {
    delete process.env.ELEVENLABS_API_KEY;
    expect(() => new ElevenLabsScribeRealtimeProvider({ id: 'elevenlabs-scribe-realtime' }))
      .toThrow(/ELEVENLABS_API_KEY/);
  });

  it('builds the realtime URL with model, pcm_16000, manual commit + language, auth header', async () => {
    const fake = makeFakeWebSocketCtor();
    const provider = makeProvider(fake);
    const sessionP = provider.openSession({ language: 'ko' });
    fake.latest().triggerOpen();
    await sessionP;
    const url = new URL(fake.latest().url);
    expect(url.pathname).toBe('/v1/speech-to-text/realtime');
    expect(url.searchParams.get('model_id')).toBe('scribe_v2_realtime');
    expect(url.searchParams.get('audio_format')).toBe('pcm_16000');
    expect(url.searchParams.get('commit_strategy')).toBe('manual');
    expect(url.searchParams.get('language_code')).toBe('ko');
    expect((fake.latest().opts as { headers: Record<string, string> }).headers['xi-api-key'])
      .toBe('xi-test-key');
  });

  it('pushAudio sends base64 input_audio_chunk with commit:false', async () => {
    const fake = makeFakeWebSocketCtor();
    const provider = makeProvider(fake);
    const sessionP = provider.openSession();
    fake.latest().triggerOpen();
    const session = await sessionP;
    const pcm = Buffer.from([1, 2, 3, 4]);
    session.pushAudio(pcm);
    expect(fake.latest().sent.length).toBe(1);
    const msg = JSON.parse(fake.latest().sent[0]!);
    expect(msg.message_type).toBe('input_audio_chunk');
    expect(msg.commit).toBe(false);
    expect(msg.sample_rate).toBe(16_000);
    expect(Buffer.from(msg.audio_base_64, 'base64').equals(pcm)).toBe(true);
  });

  it('maps partial_transcript → onPartial and committed_transcript → onFinal', async () => {
    const fake = makeFakeWebSocketCtor();
    const provider = makeProvider(fake);
    const partials: string[] = [];
    const finals: string[] = [];
    const sessionP = provider.openSession({
      onPartial: (t) => partials.push(t),
      onFinal: (t) => finals.push(t),
    });
    fake.latest().triggerOpen();
    await sessionP;
    fake.latest().triggerMessage(JSON.stringify({ message_type: 'session_started', session_id: 's1' }));
    fake.latest().triggerMessage(JSON.stringify({ message_type: 'partial_transcript', text: '안녕' }));
    fake.latest().triggerMessage(JSON.stringify({ message_type: 'partial_transcript', text: '안녕하세요' }));
    fake.latest().triggerMessage(JSON.stringify({ message_type: 'committed_transcript', text: '안녕하세요.' }));
    expect(partials).toEqual(['안녕', '안녕하세요']);
    expect(finals).toEqual(['안녕하세요.']);
  });

  it('finalize sends empty commit chunk and closes on committed reply', async () => {
    const fake = makeFakeWebSocketCtor();
    const provider = makeProvider(fake);
    const finals: string[] = [];
    const sessionP = provider.openSession({ onFinal: (t) => finals.push(t) });
    fake.latest().triggerOpen();
    const session = await sessionP;
    session.pushAudio(Buffer.from([9, 9]));
    const finalizeP = session.finalize();
    const commitMsg = JSON.parse(fake.latest().sent[fake.latest().sent.length - 1]!);
    expect(commitMsg.commit).toBe(true);
    expect(commitMsg.audio_base_64).toBe('');
    fake.latest().triggerMessage(JSON.stringify({ message_type: 'committed_transcript', text: '커밋된 문장' }));
    await finalizeP;
    expect(finals).toEqual(['커밋된 문장']);
    expect(fake.latest().closed).toBe(true);
    expect(session.isOpen()).toBe(false);
  });

  it('error-type messages surface through onError', async () => {
    const fake = makeFakeWebSocketCtor();
    const provider = makeProvider(fake);
    const errors: string[] = [];
    const sessionP = provider.openSession({ onError: (e) => errors.push(e.message) });
    fake.latest().triggerOpen();
    await sessionP;
    fake.latest().triggerMessage(JSON.stringify({ message_type: 'quota_exceeded', error: 'out of credits' }));
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('quota_exceeded');
    expect(errors[0]).toContain('out of credits');
  });

  it('records STT cost once on finalize (and not again on abort)', async () => {
    // 갭 #1 (2026-07-12): scribe 경로는 recordStt 배선이 없어 STT 비용이
    // 통째로 누락됐다. 16k mono s16 = 32 bytes/ms 로 근사 기록해야 한다.
    const tracker = createVoiceCostTracker({ disablePersist: true });
    const restore = setGlobalVoiceCostTrackerForTesting(tracker);
    try {
      const fake = makeFakeWebSocketCtor();
      const provider = makeProvider(fake);
      const sessionP = provider.openSession();
      fake.latest().triggerOpen();
      const session = await sessionP;
      session.pushAudio(Buffer.alloc(3200)); // 100 ms
      session.pushAudio(Buffer.alloc(1600)); // 50 ms
      const finalizeP = session.finalize();
      fake.latest().triggerMessage(JSON.stringify({ message_type: 'committed_transcript', text: 'ok' }));
      await finalizeP;
      await session.abort(); // once-guard — no double count
      const summary = tracker.getProcessSummary();
      expect(summary.sttDurationSec).toBeCloseTo(0.15, 5);
      expect(summary.totalUsd).toBeGreaterThan(0);
    } finally {
      restore();
    }
  });

  it('records STT cost on abort so superseded sessions still count', async () => {
    const tracker = createVoiceCostTracker({ disablePersist: true });
    const restore = setGlobalVoiceCostTrackerForTesting(tracker);
    try {
      const fake = makeFakeWebSocketCtor();
      const provider = makeProvider(fake);
      const sessionP = provider.openSession();
      fake.latest().triggerOpen();
      const session = await sessionP;
      session.pushAudio(Buffer.alloc(6400)); // 200 ms
      await session.abort();
      expect(tracker.getProcessSummary().sttDurationSec).toBeCloseTo(0.2, 5);
    } finally {
      restore();
    }
  });

  it('factory + env resolution accept the new id', async () => {
    process.env.ELEVENLABS_API_KEY = 'xi-test-key';
    process.env.STREAMING_STT_PROVIDER = 'elevenlabs-scribe-realtime';
    expect(resolveStreamingSTTProviderIdFromEnv()).toBe('elevenlabs-scribe-realtime');
    const provider = await createStreamingSTTProvider({ id: 'elevenlabs-scribe-realtime' });
    expect(provider.id).toBe('elevenlabs-scribe-realtime');
    expect(provider.format.sampleRate).toBe(16_000);
  });
});
