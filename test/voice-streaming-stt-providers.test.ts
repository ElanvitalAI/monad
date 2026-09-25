// PR-S1V.8 (sprint 22 Phase 3) — Per-provider streaming STT tests.
//
// Each WebSocket-backed provider gets a fake WebSocket constructor
// injected via `cfg.WebSocketCtor`. The fake exposes test hooks so the
// test can assert send() shape, simulate server events, and observe
// state transitions.
//
// whisper-cpp-local can't easily use a fake subprocess seam without
// touching the production code structure; we cover its config /
// unavailable branches at the factory level.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { OpenAIRealtimeSTTProvider } from '../src/voice/streaming-stt/streaming-stt-providers/openai-realtime-stt.js';
import { GeminiLiveSTTProvider } from '../src/voice/streaming-stt/streaming-stt-providers/gemini-live-stt.js';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL_ENV)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    process.env[k] = v;
  }
});

// ── Fake WebSocket harness ─────────────────────────────────────────

interface FakeWS {
  url: string;
  protocols: string | string[] | undefined;
  sent: string[];
  closed: boolean;
  triggerOpen(): void;
  triggerMessage(data: string): void;
  triggerError(message?: string): void;
  triggerClose(): void;
}

function makeFakeWebSocketCtor(): { ctor: typeof WebSocket; latest: () => FakeWS } {
  let last: FakeWS | null = null;
  // Build a minimal class that matches the bits the providers touch.
  class Fake {
    url: string;
    protocols: string | string[] | undefined;
    sent: string[] = [];
    closed = false;
    private listeners: Record<string, Array<(ev: unknown) => void>> = {};
    constructor(url: string, protocols?: string | string[]) {
      this.url = url;
      this.protocols = protocols;
      const self = this;
      const handle: FakeWS = {
        url,
        protocols,
        sent: this.sent,
        closed: false,
        triggerOpen: () => self.dispatch('open', {}),
        triggerMessage: (data: string) => self.dispatch('message', { data }),
        triggerError: (message?: string) =>
          self.dispatch('error', message !== undefined ? { message } : {}),
        triggerClose: () => {
          self.closed = true;
          self.dispatch('close', {});
        },
      };
      // Mirror `closed` from the instance via a property getter.
      Object.defineProperty(handle, 'closed', {
        get: () => self.closed,
      });
      last = handle;
    }
    addEventListener(event: string, cb: (ev: unknown) => void): void {
      (this.listeners[event] ??= []).push(cb);
    }
    removeEventListener(event: string, cb: (ev: unknown) => void): void {
      const arr = this.listeners[event];
      if (!arr) return;
      const idx = arr.indexOf(cb);
      if (idx >= 0) arr.splice(idx, 1);
    }
    send(data: string): void { this.sent.push(data); }
    close(): void {
      this.closed = true;
      this.dispatch('close', {});
    }
    private dispatch(event: string, ev: unknown): void {
      const arr = this.listeners[event];
      if (!arr) return;
      for (const cb of arr.slice()) cb(ev);
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

// ── OpenAI Realtime STT ────────────────────────────────────────────

describe('OpenAIRealtimeSTTProvider', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'sk-test-rt';
  });

  it('opens WebSocket with realtime URL + subprotocol auth', async () => {
    const { ctor, latest } = makeFakeWebSocketCtor();
    const p = new OpenAIRealtimeSTTProvider({ id: 'openai-realtime-stt', WebSocketCtor: ctor });
    const sessionPromise = p.openSession({});
    // Simulate server completing handshake immediately
    latest().triggerOpen();
    const session = await sessionPromise;
    const ws = latest();
    // 2026-04-30: URL `?model=<base>` is the realtime base model;
    // transcription model lives in the session.update payload's
    // `audio.input.transcription.model`. Server rejects transcription-
    // only models like `gpt-4o-mini-transcribe` in the URL ("not
    // supported in realtime mode").
    //
    // 2026-06-02 (G-VOX-1 · PR #3126): default base model bumped from
    // legacy `gpt-4o-realtime-preview` (deprecated for sk-proj-* keys)
    // → GA `gpt-realtime`.
    expect(ws.url).toBe(
      'wss://api.openai.com/v1/realtime?model=gpt-realtime',
    );
    expect(Array.isArray(ws.protocols)).toBe(true);
    const protos = ws.protocols as string[];
    // OpenAI realtime spec (2026-04-30): subprotocol order is
    // ["realtime", "openai-insecure-api-key.<key>"]. Legacy
    // `openai-beta.realtime-v1` is gone — server returns close 1002
    // "Mismatch client protocol" if sent.
    expect(protos[0]).toBe('realtime');
    expect(protos[1]).toBe('openai-insecure-api-key.sk-test-rt');
    expect(session.isOpen()).toBe(true);
  });

  it('accumulates delta tokens into running partial snapshot (G-VOX-5)', async () => {
    // 2026-06-02 (G-VOX-5 · PR #3127 follow-up): OpenAI Realtime API
    // `transcription.delta` 이벤트의 `delta` 필드는 incremental token
    // chunk. 그러나 클라이언트 (iOS handleTranscript) 는 partial =
    // 현재 발화 누적 snapshot 으로 가정. provider 가 wire 정합을 위해
    // 델타를 누적해 cumulative snapshot 으로 emit.
    const { ctor, latest } = makeFakeWebSocketCtor();
    const p = new OpenAIRealtimeSTTProvider({ id: 'openai-realtime-stt', WebSocketCtor: ctor });
    const partials: string[] = [];
    const finals: string[] = [];
    const sessionPromise = p.openSession({
      onPartial: (t) => partials.push(t),
      onFinal: (t) => finals.push(t),
    });
    latest().triggerOpen();
    await sessionPromise;
    latest().triggerMessage(JSON.stringify({
      type: 'conversation.item.input_audio_transcription.delta',
      delta: '안녕',
    }));
    latest().triggerMessage(JSON.stringify({
      type: 'conversation.item.input_audio_transcription.delta',
      delta: '하세요',
    }));
    latest().triggerMessage(JSON.stringify({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: '안녕하세요',
    }));
    // partials 는 매번 누적된 snapshot. 두 델타 → "안녕" → "안녕하세요".
    expect(partials).toEqual(['안녕', '안녕하세요']);
    expect(finals).toEqual(['안녕하세요']);

    // 다음 utterance 의 델타는 fresh 버퍼에서 시작 (.completed 가 reset).
    latest().triggerMessage(JSON.stringify({
      type: 'conversation.item.input_audio_transcription.delta',
      delta: '잘',
    }));
    latest().triggerMessage(JSON.stringify({
      type: 'conversation.item.input_audio_transcription.delta',
      delta: ' 지내세요',
    }));
    expect(partials).toEqual(['안녕', '안녕하세요', '잘', '잘 지내세요']);
  });

  it('routes `.added` snapshot + `.done` final from item-event path', async () => {
    // gpt-4o-mini-transcribe 가 `.delta` 대신 `conversation.item.added`
    // 의 `item.content[].transcript` 로 full snapshot 을 보내는 케이스.
    // pendingPartial 을 snapshot 으로 overwrite + onPartial 그대로 forward.
    const { ctor, latest } = makeFakeWebSocketCtor();
    const p = new OpenAIRealtimeSTTProvider({ id: 'openai-realtime-stt', WebSocketCtor: ctor });
    const partials: string[] = [];
    const finals: string[] = [];
    const sessionPromise = p.openSession({
      onPartial: (t) => partials.push(t),
      onFinal: (t) => finals.push(t),
    });
    latest().triggerOpen();
    await sessionPromise;
    latest().triggerMessage(JSON.stringify({
      type: 'conversation.item.added',
      item: { content: [{ type: 'audio', transcript: '안녕' }] },
    }));
    latest().triggerMessage(JSON.stringify({
      type: 'conversation.item.added',
      item: { content: [{ type: 'audio', transcript: '안녕하세요' }] },
    }));
    latest().triggerMessage(JSON.stringify({
      type: 'conversation.item.done',
      item: { content: [{ type: 'audio', transcript: '안녕하세요' }] },
    }));
    expect(partials).toEqual(['안녕', '안녕하세요']);
    expect(finals).toEqual(['안녕하세요']);
  });

  it('pushAudio sends base64-encoded PCM', async () => {
    const { ctor, latest } = makeFakeWebSocketCtor();
    const p = new OpenAIRealtimeSTTProvider({ id: 'openai-realtime-stt', WebSocketCtor: ctor });
    const sessionPromise = p.openSession({});
    latest().triggerOpen();
    const session = await sessionPromise;
    const ws = latest();
    ws.sent.length = 0; // clear setup messages
    // 2026-04-30: audio-capture is now 24kHz globally; pushAudio
    // forwards the bytes verbatim to the realtime endpoint (no
    // resample). 4 bytes in / 4 bytes out.
    const pcm = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    session.pushAudio(pcm);
    expect(ws.sent.length).toBeGreaterThan(0);
    const last = ws.sent[ws.sent.length - 1]!;
    const parsed = JSON.parse(last);
    expect(parsed.type).toBe('input_audio_buffer.append');
    expect(parsed.audio).toBe(pcm.toString('base64'));
  });

  it('finalize commits buffer and closes WebSocket', async () => {
    const { ctor, latest } = makeFakeWebSocketCtor();
    const p = new OpenAIRealtimeSTTProvider({ id: 'openai-realtime-stt', WebSocketCtor: ctor });
    const sessionPromise = p.openSession({});
    latest().triggerOpen();
    const session = await sessionPromise;
    const ws = latest();
    const finalizeP = session.finalize();
    // Simulate server closing after commit
    latest().triggerClose();
    await finalizeP;
    const commit = ws.sent.find((m) => JSON.parse(m).type === 'input_audio_buffer.commit');
    expect(commit).toBeDefined();
    expect(session.isOpen()).toBe(false);
  });

  it('abort closes session without commit', async () => {
    const { ctor, latest } = makeFakeWebSocketCtor();
    const p = new OpenAIRealtimeSTTProvider({ id: 'openai-realtime-stt', WebSocketCtor: ctor });
    const sessionPromise = p.openSession({});
    latest().triggerOpen();
    const session = await sessionPromise;
    const ws = latest();
    ws.sent.length = 0;
    const abortP = session.abort();
    latest().triggerClose();
    await abortP;
    const commits = ws.sent.filter((m) => JSON.parse(m).type === 'input_audio_buffer.commit');
    expect(commits).toEqual([]);
    expect(session.isOpen()).toBe(false);
  });
});

// ── Gemini Live STT ────────────────────────────────────────────────

describe('GeminiLiveSTTProvider', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'gemini-test-key';
  });

  it('opens WebSocket with API key in URL + sends setup', async () => {
    const { ctor, latest } = makeFakeWebSocketCtor();
    const p = new GeminiLiveSTTProvider({ id: 'gemini-live-stt', WebSocketCtor: ctor });
    const sessionPromise = p.openSession({});
    latest().triggerOpen();
    // Setup ack
    latest().triggerMessage(JSON.stringify({ setupComplete: {} }));
    const session = await sessionPromise;
    const ws = latest();
    expect(ws.url).toContain('generativelanguage.googleapis.com');
    expect(ws.url).toContain('key=gemini-test-key');
    const setup = JSON.parse(ws.sent[0]!);
    expect(setup.setup.model).toContain('gemini-2.5-flash-live-preview');
    expect(setup.setup.inputAudioTranscription).toBeDefined();
    expect(session.isOpen()).toBe(true);
  });

  it('routes serverContent.inputTranscription events', async () => {
    const { ctor, latest } = makeFakeWebSocketCtor();
    const p = new GeminiLiveSTTProvider({ id: 'gemini-live-stt', WebSocketCtor: ctor });
    const partials: string[] = [];
    const finals: string[] = [];
    const sessionPromise = p.openSession({
      onPartial: (t) => partials.push(t),
      onFinal: (t) => finals.push(t),
    });
    latest().triggerOpen();
    latest().triggerMessage(JSON.stringify({ setupComplete: {} }));
    await sessionPromise;
    latest().triggerMessage(JSON.stringify({
      serverContent: { inputTranscription: { text: 'hello' } },
    }));
    latest().triggerMessage(JSON.stringify({
      serverContent: { inputTranscription: { text: 'hello world', finished: true } },
    }));
    expect(partials).toEqual(['hello']);
    expect(finals).toEqual(['hello world']);
  });

  it('pushAudio sends realtimeInput.audio with mimeType', async () => {
    const { ctor, latest } = makeFakeWebSocketCtor();
    const p = new GeminiLiveSTTProvider({ id: 'gemini-live-stt', WebSocketCtor: ctor });
    const sessionPromise = p.openSession({});
    latest().triggerOpen();
    latest().triggerMessage(JSON.stringify({ setupComplete: {} }));
    const session = await sessionPromise;
    const ws = latest();
    ws.sent.length = 0;
    session.pushAudio(Buffer.from([0xAA, 0xBB]));
    const parsed = JSON.parse(ws.sent[0]!);
    expect(parsed.realtimeInput.audio.mimeType).toBe('audio/pcm;rate=16000');
    expect(parsed.realtimeInput.audio.data).toBe(Buffer.from([0xAA, 0xBB]).toString('base64'));
  });

  it('finalize sends audioStreamEnd then closes', async () => {
    const { ctor, latest } = makeFakeWebSocketCtor();
    const p = new GeminiLiveSTTProvider({ id: 'gemini-live-stt', WebSocketCtor: ctor });
    const sessionPromise = p.openSession({});
    latest().triggerOpen();
    latest().triggerMessage(JSON.stringify({ setupComplete: {} }));
    const session = await sessionPromise;
    const ws = latest();
    const finalizeP = session.finalize();
    latest().triggerClose();
    await finalizeP;
    const ended = ws.sent.find((m) => {
      try { return JSON.parse(m).realtimeInput?.audioStreamEnd === true; } catch { return false; }
    });
    expect(ended).toBeDefined();
  });
});
