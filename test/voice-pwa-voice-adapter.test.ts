// PR-S1V.12 (sprint 22 Phase 7) — PWA voice server-side adapter.

import { afterEach, describe, expect, it } from 'bun:test';
import {
  createStubPwaVoiceAdapter,
  createPwaVoiceAdapter,
  isPwaVoiceEnabled,
  PWA_VOICE_FRAME_KIND,
  PwaVoiceUnavailableError,
} from '../src/voice/channel-adapters/pwa-voice-adapter.js';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL_ENV)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    process.env[k] = v;
  }
});

// Helper to access stub-only test methods.
type StubExtras = {
  takeUpstream: () => Array<{ pcm: Buffer }>;
  emitDownstream: (frame: { pcm: Buffer }) => void;
  emitState: (state: string) => void;
  finalizeCount: () => number;
  interruptCount: () => number;
};
function asStub(s: unknown): StubExtras {
  return s as unknown as StubExtras;
}

// ── Stub adapter ───────────────────────────────────────────────────

describe('createStubPwaVoiceAdapter', () => {
  it('openSession resolves and reaches streaming state', async () => {
    const adapter = createStubPwaVoiceAdapter();
    const session = await adapter.openSession();
    expect(['connecting', 'streaming']).toContain(session.getState());
    await new Promise((r) => setImmediate(r));
    expect(session.getState()).toBe('streaming');
  });

  it('failWith causes openSession to reject Unavailable', async () => {
    const adapter = createStubPwaVoiceAdapter({ failWith: 'no shell' });
    expect(adapter.available).toBe(false);
    await expect(adapter.openSession()).rejects.toThrow(PwaVoiceUnavailableError);
  });

  it('pushUpstream captures only while streaming', async () => {
    const adapter = createStubPwaVoiceAdapter();
    const session = await adapter.openSession();
    const stub = asStub(session);
    stub.emitState('connecting');
    session.pushUpstream({ pcm: Buffer.from([1, 2]) });
    expect(stub.takeUpstream().length).toBe(0);
    stub.emitState('streaming');
    session.pushUpstream({ pcm: Buffer.from([3, 4]) });
    const captured = stub.takeUpstream();
    expect(captured.length).toBe(1);
    expect(Array.from(captured[0]!.pcm)).toEqual([3, 4]);
  });

  it('finalize is counted', async () => {
    const adapter = createStubPwaVoiceAdapter();
    const session = await adapter.openSession();
    const stub = asStub(session);
    await session.finalize();
    await session.finalize();
    expect(stub.finalizeCount()).toBe(2);
  });

  it('interrupt is counted (BI-1 manual barge-in · Phase D)', async () => {
    const adapter = createStubPwaVoiceAdapter();
    const session = await adapter.openSession();
    const stub = asStub(session);
    await session.interrupt!();
    await session.interrupt!();
    await session.interrupt!();
    expect(stub.interruptCount()).toBe(3);
    // finalize untouched.
    expect(stub.finalizeCount()).toBe(0);
  });

  it('downstream subscribers receive emitted frames', async () => {
    const adapter = createStubPwaVoiceAdapter();
    const session = await adapter.openSession();
    await new Promise((r) => setImmediate(r));
    const received: Buffer[] = [];
    session.onDownstream((f) => received.push(f.pcm));
    asStub(session).emitDownstream({ pcm: Buffer.from([0xAA, 0xBB]) });
    expect(received.length).toBe(1);
    expect(Array.from(received[0]!)).toEqual([0xAA, 0xBB]);
  });

  it('close transitions through closing → closed', async () => {
    const adapter = createStubPwaVoiceAdapter();
    const session = await adapter.openSession();
    await new Promise((r) => setImmediate(r));
    const seen: string[] = [];
    session.onStateChange((s) => seen.push(s));
    await session.close();
    expect(seen).toContain('closing');
    expect(seen).toContain('closed');
    expect(session.getState()).toBe('closed');
  });

  it('shutdown closes any active session', async () => {
    const adapter = createStubPwaVoiceAdapter();
    const session = await adapter.openSession();
    await adapter.shutdown();
    expect(session.getState()).toBe('closed');
  });

  it('multiple openSession replaces previous (stub semantics)', async () => {
    const adapter = createStubPwaVoiceAdapter();
    const first = await adapter.openSession();
    const second = await adapter.openSession();
    expect(first).not.toBe(second);
    // first should be closed
    await new Promise((r) => setImmediate(r));
    expect(first.getState()).toBe('closed');
  });
});

// ── Production adapter (no STT — legacy unavailable) ───────────────

describe('createPwaVoiceAdapter (no sttProvider — legacy unavailable)', () => {
  it('reports unavailable with a helpful reason', () => {
    const adapter = createPwaVoiceAdapter();
    expect(adapter.available).toBe(false);
    expect(adapter.unavailableReason).toContain('sttProvider');
  });

  it('openSession rejects with Unavailable', async () => {
    const adapter = createPwaVoiceAdapter();
    await expect(adapter.openSession()).rejects.toThrow(PwaVoiceUnavailableError);
  });
});

// ── Production adapter (with sttProvider — wired) ──────────────────

describe('createPwaVoiceAdapter (sttProvider wired — Phase 7 frontend)', () => {
  function fakeSttProvider() {
    const sessions: Array<{
      pushed: Buffer[];
      finals: string[];
      partials: string[];
      open: boolean;
      triggerFinal: (text: string) => void;
      triggerPartial: (text: string) => void;
      finalize: () => Promise<void>;
      abort: () => Promise<void>;
    }> = [];
    let cb: { onFinal?: (t: string) => void; onPartial?: (t: string) => void } = {};
    const provider = {
      id: 'openai-realtime-stt' as const,
      format: { sampleRate: 16000, channels: 1, bitsPerSample: 16 } as const,
      async openSession(opts: { onFinal?: (t: string) => void; onPartial?: (t: string) => void } = {}) {
        cb = opts;
        const entry = {
          pushed: [] as Buffer[],
          finals: [] as string[],
          partials: [] as string[],
          open: true,
          triggerFinal: (text: string) => { entry.finals.push(text); cb.onFinal?.(text); },
          triggerPartial: (text: string) => { entry.partials.push(text); cb.onPartial?.(text); },
          async finalize() { entry.open = false; },
          async abort() { entry.open = false; },
        };
        sessions.push(entry);
        return {
          pushAudio: (pcm: Buffer) => { if (entry.open) entry.pushed.push(pcm); },
          finalize: entry.finalize,
          abort: entry.abort,
          isOpen: () => entry.open,
        };
      },
    };
    return { provider, sessions };
  }

  it('reports available when sttProvider supplied', () => {
    const { provider } = fakeSttProvider();
    const adapter = createPwaVoiceAdapter({ sttProvider: provider });
    expect(adapter.available).toBe(true);
    expect(adapter.unavailableReason).toBeNull();
  });

  it('openSession opens a real STT session and forwards upstream PCM', async () => {
    const { provider, sessions } = fakeSttProvider();
    const adapter = createPwaVoiceAdapter({ sttProvider: provider });
    const session = await adapter.openSession();
    expect(session.getState()).toBe('streaming');
    session.pushUpstream({ pcm: Buffer.from([0x01, 0x02]) });
    session.pushUpstream({ pcm: Buffer.from([0x03, 0x04]) });
    expect(sessions[0].pushed.map((b) => Array.from(b))).toEqual([
      [0x01, 0x02],
      [0x03, 0x04],
    ]);
  });

  it('STT final transcript reaches onFinalTranscript with sessionId', async () => {
    const { provider, sessions } = fakeSttProvider();
    const finals: Array<[string, string]> = [];
    const adapter = createPwaVoiceAdapter({
      sttProvider: provider,
      onFinalTranscript: (text, id) => finals.push([text, id]),
    });
    await adapter.openSession();
    sessions[0].triggerFinal('안녕하세요');
    expect(finals.length).toBe(1);
    expect(finals[0][0]).toBe('안녕하세요');
    expect(finals[0][1]).toMatch(/^pwa:/);
  });

  it('partial transcripts reach onPartialTranscript', async () => {
    const { provider, sessions } = fakeSttProvider();
    const partials: string[] = [];
    const adapter = createPwaVoiceAdapter({
      sttProvider: provider,
      onPartialTranscript: (text) => partials.push(text),
    });
    await adapter.openSession();
    sessions[0].triggerPartial('안녕');
    sessions[0].triggerPartial('하세요');
    expect(partials).toEqual(['안녕', '하세요']);
  });

  it('finalize calls STT.finalize', async () => {
    const { provider, sessions } = fakeSttProvider();
    const adapter = createPwaVoiceAdapter({ sttProvider: provider });
    const session = await adapter.openSession();
    await session.finalize();
    expect(sessions[0].open).toBe(false);
  });

  it('close transitions through closing → closed and aborts STT', async () => {
    const { provider, sessions } = fakeSttProvider();
    const adapter = createPwaVoiceAdapter({ sttProvider: provider });
    const session = await adapter.openSession();
    const states: string[] = [];
    session.onStateChange((s) => states.push(s));
    await session.close();
    expect(states).toContain('closing');
    expect(states).toContain('closed');
    expect(sessions[0].open).toBe(false);
  });

  it('shutdown closes all active sessions', async () => {
    const { provider, sessions } = fakeSttProvider();
    const adapter = createPwaVoiceAdapter({ sttProvider: provider });
    const a = await adapter.openSession();
    const b = await adapter.openSession();
    await adapter.shutdown();
    expect(a.getState()).toBe('closed');
    expect(b.getState()).toBe('closed');
    expect(sessions.every((s) => !s.open)).toBe(true);
  });

  it('upstream PCM dropped when not in streaming state', async () => {
    const { provider, sessions } = fakeSttProvider();
    const adapter = createPwaVoiceAdapter({ sttProvider: provider });
    const session = await adapter.openSession();
    await session.close();
    session.pushUpstream({ pcm: Buffer.from([0xff]) });
    expect(sessions[0].pushed.length).toBe(0);
  });

  // ── §C — server-side emit + lifecycle hooks ─────────────────────

  it('production session exposes a sessionId starting with "pwa:"', async () => {
    const { provider } = fakeSttProvider();
    const adapter = createPwaVoiceAdapter({ sttProvider: provider });
    const session = await adapter.openSession();
    expect(typeof session.sessionId).toBe('string');
    expect(session.sessionId).toMatch(/^pwa:/);
  });

  it('emitDownstream fans out to every onDownstream subscriber', async () => {
    const { provider } = fakeSttProvider();
    const adapter = createPwaVoiceAdapter({ sttProvider: provider });
    const session = await adapter.openSession();
    const a: Buffer[] = [];
    const b: Buffer[] = [];
    session.onDownstream((f) => a.push(f.pcm));
    session.onDownstream((f) => b.push(f.pcm));
    session.emitDownstream!({ pcm: Buffer.from([0xaa, 0xbb]) });
    expect(a.length).toBe(1);
    expect(b.length).toBe(1);
    expect(Array.from(a[0]!)).toEqual([0xaa, 0xbb]);
  });

  it('emitDownstream is a no-op after close', async () => {
    const { provider } = fakeSttProvider();
    const adapter = createPwaVoiceAdapter({ sttProvider: provider });
    const session = await adapter.openSession();
    const out: Buffer[] = [];
    session.onDownstream((f) => out.push(f.pcm));
    await session.close();
    session.emitDownstream!({ pcm: Buffer.from([0xff]) });
    expect(out.length).toBe(0);
  });

  it('onSessionOpen fires once with the freshly opened session', async () => {
    const { provider } = fakeSttProvider();
    const opened: Array<{ id: string | undefined }> = [];
    const adapter = createPwaVoiceAdapter({
      sttProvider: provider,
      onSessionOpen: (s) => opened.push({ id: s.sessionId }),
    });
    const a = await adapter.openSession();
    const b = await adapter.openSession();
    expect(opened.length).toBe(2);
    expect(opened[0]!.id).toBe(a.sessionId);
    expect(opened[1]!.id).toBe(b.sessionId);
  });

  it('onSessionClose fires once per session — manual close + shutdown both work', async () => {
    const { provider } = fakeSttProvider();
    const closed: string[] = [];
    const adapter = createPwaVoiceAdapter({
      sttProvider: provider,
      onSessionClose: (s) => { if (s.sessionId) closed.push(s.sessionId); },
    });
    const a = await adapter.openSession();
    const b = await adapter.openSession();
    await a.close();
    await adapter.shutdown();
    expect(closed.length).toBe(2);
    expect(closed).toContain(a.sessionId!);
    expect(closed).toContain(b.sessionId!);
  });

  it('onSessionOpen errors are isolated — adapter still returns the session', async () => {
    const { provider } = fakeSttProvider();
    const adapter = createPwaVoiceAdapter({
      sttProvider: provider,
      onSessionOpen: () => { throw new Error('hook bug'); },
    });
    const session = await adapter.openSession();
    expect(session.getState()).toBe('streaming');
    expect(session.sessionId).toMatch(/^pwa:/);
  });

  // ── Live transcript fan-out (DOWNSTREAM_TRANSCRIPT plumbing) ────

  it('STT partial fires onTranscript with kind="partial"', async () => {
    const { provider, sessions } = fakeSttProvider();
    const adapter = createPwaVoiceAdapter({ sttProvider: provider });
    const session = await adapter.openSession();
    const events: Array<{ kind: string; text: string }> = [];
    session.onTranscript!((e) => events.push(e));
    sessions[0].triggerPartial('안녕');
    sessions[0].triggerPartial('안녕하');
    expect(events).toEqual([
      { kind: 'partial', text: '안녕' },
      { kind: 'partial', text: '안녕하' },
    ]);
  });

  it('STT final fires onTranscript with kind="final"', async () => {
    const { provider, sessions } = fakeSttProvider();
    const adapter = createPwaVoiceAdapter({ sttProvider: provider });
    const session = await adapter.openSession();
    const events: Array<{ kind: string; text: string }> = [];
    session.onTranscript!((e) => events.push(e));
    sessions[0].triggerFinal('안녕하세요');
    expect(events).toEqual([{ kind: 'final', text: '안녕하세요' }]);
  });

  it('emitTranscript with kind="assistant" fans to subscribers', async () => {
    const { provider } = fakeSttProvider();
    const adapter = createPwaVoiceAdapter({ sttProvider: provider });
    const session = await adapter.openSession();
    const events: Array<{ kind: string; text: string }> = [];
    session.onTranscript!((e) => events.push(e));
    session.emitTranscript!({ kind: 'assistant', text: '응답' });
    session.emitTranscript!({ kind: 'assistant', text: '입니다' });
    expect(events).toEqual([
      { kind: 'assistant', text: '응답' },
      { kind: 'assistant', text: '입니다' },
    ]);
  });

  it('transcript fan-out is suppressed after close', async () => {
    const { provider, sessions } = fakeSttProvider();
    const adapter = createPwaVoiceAdapter({ sttProvider: provider });
    const session = await adapter.openSession();
    const events: Array<{ kind: string; text: string }> = [];
    session.onTranscript!((e) => events.push(e));
    await session.close();
    sessions[0].triggerFinal('too late');
    session.emitTranscript!({ kind: 'assistant', text: 'too late' });
    expect(events).toHaveLength(0);
  });

  it('onTranscript unsubscribe handle stops further events', async () => {
    const { provider, sessions } = fakeSttProvider();
    const adapter = createPwaVoiceAdapter({ sttProvider: provider });
    const session = await adapter.openSession();
    const events: Array<{ kind: string; text: string }> = [];
    const unsub = session.onTranscript!((e) => events.push(e));
    sessions[0].triggerPartial('first');
    unsub();
    sessions[0].triggerPartial('second');
    expect(events).toEqual([{ kind: 'partial', text: 'first' }]);
  });
});

// ── Env gate ───────────────────────────────────────────────────────

describe('isPwaVoiceEnabled', () => {
  it('true when MONAD_PWA_VOICE unset (default-on)', () => {
    delete process.env.MONAD_PWA_VOICE;
    expect(isPwaVoiceEnabled()).toBe(true);
  });

  it('false only for explicit opt-out MONAD_PWA_VOICE values', () => {
    for (const v of ['0', 'false', 'off', 'no', ' FALSE ', 'Off', ' NO ']) {
      process.env.MONAD_PWA_VOICE = v;
      expect(isPwaVoiceEnabled()).toBe(false);
    }
    for (const v of ['1', 'true', 'on', 'YES', 'On']) {
      process.env.MONAD_PWA_VOICE = v;
      expect(isPwaVoiceEnabled()).toBe(true);
    }
  });
});

// ── Frame protocol ─────────────────────────────────────────────────

describe('PWA_VOICE_FRAME_KIND', () => {
  it('reserves distinct codes for each frame kind', () => {
    const codes = Object.values(PWA_VOICE_FRAME_KIND);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('upstream codes are < 0x80, downstream >= 0x80', () => {
    expect(PWA_VOICE_FRAME_KIND.UPSTREAM_PCM).toBeLessThan(0x80);
    expect(PWA_VOICE_FRAME_KIND.UPSTREAM_FINALIZE).toBeLessThan(0x80);
    expect(PWA_VOICE_FRAME_KIND.UPSTREAM_HELLO).toBeLessThan(0x80);
    expect(PWA_VOICE_FRAME_KIND.DOWNSTREAM_PCM).toBeGreaterThanOrEqual(0x80);
    expect(PWA_VOICE_FRAME_KIND.DOWNSTREAM_STATE).toBeGreaterThanOrEqual(0x80);
    expect(PWA_VOICE_FRAME_KIND.DOWNSTREAM_ERROR).toBeGreaterThanOrEqual(0x80);
  });
});
