// CV-3 mobile-readiness #3 · voice-intake helper tests.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  buildIntakeBodyForVoice,
  postVoiceIntake,
  resolveSpeechRecognition,
  startVoiceRecognition,
} from './voice-intake';

// ─── resolveSpeechRecognition ─────────────────────────────────────

describe('resolveSpeechRecognition', () => {
  let originalSR: unknown;
  let originalWebkit: unknown;

  beforeEach(() => {
    const w = globalThis as Record<string, unknown>;
    originalSR = w.SpeechRecognition;
    originalWebkit = w.webkitSpeechRecognition;
    delete w.SpeechRecognition;
    delete w.webkitSpeechRecognition;
  });

  afterEach(() => {
    const w = globalThis as Record<string, unknown>;
    if (originalSR === undefined) delete w.SpeechRecognition;
    else w.SpeechRecognition = originalSR;
    if (originalWebkit === undefined) delete w.webkitSpeechRecognition;
    else w.webkitSpeechRecognition = originalWebkit;
  });

  test('returns null when neither global is set', () => {
    expect(resolveSpeechRecognition()).toBeNull();
  });

  test('prefers SpeechRecognition over webkit prefix', () => {
    const standard = function () {} as unknown;
    const webkit = function () {} as unknown;
    (globalThis as Record<string, unknown>).SpeechRecognition = standard;
    (globalThis as Record<string, unknown>).webkitSpeechRecognition = webkit;
    expect(resolveSpeechRecognition()).toBe(standard as ReturnType<typeof resolveSpeechRecognition>);
  });

  test('falls back to webkit when standard absent', () => {
    const webkit = function () {} as unknown;
    (globalThis as Record<string, unknown>).webkitSpeechRecognition = webkit;
    expect(resolveSpeechRecognition()).toBe(webkit as ReturnType<typeof resolveSpeechRecognition>);
  });
});

// ─── startVoiceRecognition (mocked) ───────────────────────────────

interface MockEv {
  results: Array<Array<{ transcript: string; confidence: number }> & { isFinal?: boolean }>;
  resultIndex: number;
}

function makeMockRecognition() {
  let onresult: ((ev: MockEv) => void) | null = null;
  let onerror: ((ev: { error: string; message: string }) => void) | null = null;
  let onend: (() => void) | null = null;
  let started = false;

  class MockRec {
    lang = '';
    continuous = false;
    interimResults = false;
    set onresult(cb: typeof onresult) { onresult = cb; }
    get onresult() { return onresult; }
    set onerror(cb: typeof onerror) { onerror = cb; }
    get onerror() { return onerror; }
    set onend(cb: typeof onend) { onend = cb; }
    get onend() { return onend; }
    start() { started = true; }
    stop() { onend?.(); }
    abort() { onend?.(); }
  }

  return {
    Ctor: MockRec as unknown as NonNullable<NonNullable<Parameters<typeof startVoiceRecognition>[0]>['recognitionImpl']>,
    fireResult(text: string, isFinal: boolean): void {
      const r: { transcript: string; confidence: number }[] & { isFinal?: boolean } = [{ transcript: text, confidence: 0.9 }];
      r.isFinal = isFinal;
      onresult?.({ results: [r], resultIndex: 0 });
    },
    fireError(code: string, msg = ''): void {
      onerror?.({ error: code, message: msg });
    },
    isStarted(): boolean { return started; },
  };
}

describe('startVoiceRecognition', () => {
  test('returns null when API unavailable', () => {
    const session = startVoiceRecognition({ recognitionImpl: undefined });
    expect(session).toBeNull();
  });

  test('starts the underlying recognizer with default ko-KR', () => {
    const m = makeMockRecognition();
    const session = startVoiceRecognition({ recognitionImpl: m.Ctor });
    expect(session).not.toBeNull();
    expect(m.isStarted()).toBe(true);
    void session!.abort();
  });

  test('captures transcript across multiple onresult fires', async () => {
    const m = makeMockRecognition();
    const updates: string[] = [];
    const session = startVoiceRecognition({
      recognitionImpl: m.Ctor,
      onUpdate: (t) => updates.push(t),
    })!;
    m.fireResult('안녕', false);
    m.fireResult('안녕하세요', true);
    expect(updates).toEqual(['안녕', '안녕하세요']);
    expect(session.transcript).toBe('안녕하세요');
    const final = await session.stop();
    expect(final).toBe('안녕하세요');
  });

  test('forwards errors to onError callback', () => {
    const m = makeMockRecognition();
    const errors: Array<{ code: string; message: string }> = [];
    const session = startVoiceRecognition({
      recognitionImpl: m.Ctor,
      onError: (e) => errors.push(e),
    })!;
    m.fireError('no-speech', 'No speech detected');
    expect(errors).toEqual([{ code: 'no-speech', message: 'No speech detected' }]);
    void session.abort();
  });

  test('stop() resolves with the captured transcript', async () => {
    const m = makeMockRecognition();
    const session = startVoiceRecognition({ recognitionImpl: m.Ctor })!;
    m.fireResult('test transcript', true);
    expect(await session.stop()).toBe('test transcript');
    expect(session.active).toBe(false);
  });

  test('stop() called twice resolves both with same transcript', async () => {
    const m = makeMockRecognition();
    const session = startVoiceRecognition({ recognitionImpl: m.Ctor })!;
    m.fireResult('hello', true);
    const a = session.stop();
    const b = session.stop();
    expect(await a).toBe('hello');
    expect(await b).toBe('hello');
  });
});

// ─── buildIntakeBodyForVoice ─────────────────────────────────────

describe('buildIntakeBodyForVoice', () => {
  test('trims the transcript into text', () => {
    const body = buildIntakeBodyForVoice({ transcript: '   안녕   ' });
    expect(body.text).toBe('안녕');
  });
  test('marks actor=pwa-voice', () => {
    const body = buildIntakeBodyForVoice({ transcript: 'x' });
    expect(body.actor).toBe('pwa-voice');
    expect((body.channelContext as { kind: string }).kind).toBe('pwa-voice');
  });
  test('forwards explicit intakeId', () => {
    const body = buildIntakeBodyForVoice({ transcript: 'x', intakeId: 'voice-7' });
    expect(body.intakeId).toBe('voice-7');
  });
});

// ─── postVoiceIntake ─────────────────────────────────────────────

describe('postVoiceIntake', () => {
  test('rejects empty transcript without calling fetch', async () => {
    let called = false;
    const stub = (async () => { called = true; return new Response(''); }) as unknown as typeof fetch;
    const r = await postVoiceIntake({
      baseUrl: 'http://x',
      transcript: '   ',
      fetchImpl: stub,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/empty/);
    expect(called).toBe(false);
  });

  test('rejects empty baseUrl', async () => {
    const r = await postVoiceIntake({
      baseUrl: '',
      transcript: 'x',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/baseUrl/);
  });

  test('happy path → returns intakeId', async () => {
    const stub = (async (_input: string | URL | Request, init?: RequestInit) => {
      void init;
      return new Response(JSON.stringify({ intakeId: 'voice-99' }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await postVoiceIntake({
      baseUrl: 'http://daemon/',
      transcript: 'hello',
      fetchImpl: stub,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.intakeId).toBe('voice-99');
  });

  test('forwards bearer token', async () => {
    let captured: Record<string, string> = {};
    const stub = (async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      captured = headers ?? {};
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    await postVoiceIntake({
      baseUrl: 'http://daemon',
      transcript: 'hello',
      token: 'tk-1',
      fetchImpl: stub,
    });
    expect(captured.authorization).toBe('Bearer tk-1');
  });

  test('500 → ok:false with status', async () => {
    const stub = (async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;
    const r = await postVoiceIntake({
      baseUrl: 'http://daemon',
      transcript: 'x',
      fetchImpl: stub,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(500);
  });

  test('thrown fetch → ok:false with reason', async () => {
    const stub = (async () => { throw new Error('network down'); }) as unknown as typeof fetch;
    const r = await postVoiceIntake({
      baseUrl: 'http://daemon',
      transcript: 'x',
      fetchImpl: stub,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('network down');
  });
});
