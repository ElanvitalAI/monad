// PR-S1V.4 (sprint 21-Parallel-Voice · 2026-04-29) — Voice input bridge
// tests.
//
// Tested invariants:
//   1. transcribe() forwards to STTProvider.transcribeBatch with the
//      provided sttOpts.
//   2. injectTranscript() routes via prefix detection and calls
//      submitToSession with the stripped text + resolved sessionId.
//   3. No-prefix transcript falls back to focused session
//      (resolveSession(null)).
//   4. Empty transcript → reason='empty', no inject.
//   5. resolveSession returning null → reason='no-stream'.
//   6. handleTranscript is the alias used by voice-mode.
//   7. (PR-S1V.4-wiring) submitToSession failure → onSendError fires +
//      result.sendError captured + injected stays true.

import { describe, expect, mock, test } from 'bun:test';
import { createVoiceInputBridge } from '../src/voice/voice-input-bridge.js';
import type { STTProvider, STTResult } from '../src/voice/stt-provider.js';

// ── Test STT provider ───────────────────────────────────────────────

function makeFakeSTT(text: string): STTProvider {
  return {
    id: 'openai-whisper',
    transcribeBatch: mock(async (_pcm: Buffer): Promise<STTResult> => ({ text })),
  };
}

// ── transcribe() ────────────────────────────────────────────────────

describe('PR-S1V.4 · bridge.transcribe', () => {
  test('forwards PCM to STTProvider.transcribeBatch with sttOpts', async () => {
    const stt = makeFakeSTT('hello');
    const submitToSession = mock(async () => {});
    const resolveSession = mock(() => ({ sessionId: 'sess-1' }));
    const bridge = createVoiceInputBridge({
      sttProvider: stt,
      resolveSession,
      submitToSession,
      sttOpts: { language: 'ko' },
    });
    const pcm = Buffer.alloc(2048);
    const result = await bridge.transcribe(pcm);
    expect(result.text).toBe('hello');
    expect(stt.transcribeBatch).toHaveBeenCalledTimes(1);
    expect(stt.transcribeBatch).toHaveBeenCalledWith(pcm, { language: 'ko' });
  });
});

// ── injectTranscript() ──────────────────────────────────────────────

describe('PR-S1V.4 · bridge.injectTranscript — prefix routing', () => {
  test('Korean "코덱스에게 ..." routes to codex sessionId', async () => {
    const stt = makeFakeSTT('');
    const submitToSession = mock(async (_id: string, _text: string) => {});
    const resolveSession = mock((brand: string | null) =>
      brand === 'codex' ? { sessionId: 'sess-codex' } : null,
    );
    const bridge = createVoiceInputBridge({
      sttProvider: stt,
      resolveSession,
      submitToSession,
    });
    const result = await bridge.injectTranscript('코덱스에게 react 만들어줘');
    expect(result.injected).toBe(true);
    expect(result.source.kind).toBe('voice');
    expect(result.routing.brand).toBe('codex');
    expect(result.routing.text).toBe('react 만들어줘');
    expect(result.sessionId).toBe('sess-codex');
    expect(resolveSession).toHaveBeenCalledWith('codex');
    expect(submitToSession).toHaveBeenCalledWith('sess-codex', 'react 만들어줘');
  });

  test('English "to claude, ..." routes to claude sessionId', async () => {
    const stt = makeFakeSTT('');
    const submitToSession = mock(async (_id: string, _text: string) => {});
    const resolveSession = mock((brand: string | null) =>
      brand === 'claude' ? { sessionId: 'sess-claude' } : null,
    );
    const bridge = createVoiceInputBridge({
      sttProvider: stt,
      resolveSession,
      submitToSession,
    });
    const result = await bridge.injectTranscript('to claude, review please');
    expect(result.injected).toBe(true);
    expect(result.sessionId).toBe('sess-claude');
    expect(submitToSession).toHaveBeenCalledWith('sess-claude', 'review please');
  });

  test('no-prefix transcript falls back to focused session (brand=null)', async () => {
    const stt = makeFakeSTT('');
    const submitToSession = mock(async (_id: string, _text: string) => {});
    const resolveSession = mock((brand: string | null) =>
      brand === null ? { sessionId: 'sess-focus' } : null,
    );
    const bridge = createVoiceInputBridge({
      sttProvider: stt,
      resolveSession,
      submitToSession,
    });
    const result = await bridge.injectTranscript('plan 짜줘');
    expect(result.injected).toBe(true);
    expect(result.source.kind).toBe('voice');
    expect(result.routing.brand).toBe(null);
    expect(result.sessionId).toBe('sess-focus');
    expect(submitToSession).toHaveBeenCalledWith('sess-focus', 'plan 짜줘');
  });

  test('bare brand mention without postposition is NOT routed', async () => {
    const stt = makeFakeSTT('');
    const submitToSession = mock(async (_id: string, _text: string) => {});
    const resolveSession = mock((brand: string | null) =>
      brand === null ? { sessionId: 'sess-focus' } : null,
    );
    const bridge = createVoiceInputBridge({
      sttProvider: stt,
      resolveSession,
      submitToSession,
    });
    const result = await bridge.injectTranscript('코덱스 결과 보여줘');
    expect(result.injected).toBe(true);
    expect(result.routing.brand).toBe(null);
    expect(submitToSession).toHaveBeenCalledWith('sess-focus', '코덱스 결과 보여줘');
  });

  test('empty transcript → reason=empty + no inject', async () => {
    const stt = makeFakeSTT('');
    const submitToSession = mock(async () => {});
    const resolveSession = mock(() => ({ sessionId: 'x' }));
    const bridge = createVoiceInputBridge({
      sttProvider: stt,
      resolveSession,
      submitToSession,
    });
    const result = await bridge.injectTranscript('   ');
    expect(result.injected).toBe(false);
    expect(result.reason).toBe('empty');
    expect(submitToSession).not.toHaveBeenCalled();
  });

  test('resolveSession returning null → reason=no-stream + no inject', async () => {
    const stt = makeFakeSTT('');
    const submitToSession = mock(async () => {});
    const resolveSession = mock(() => null);
    const bridge = createVoiceInputBridge({
      sttProvider: stt,
      resolveSession,
      submitToSession,
    });
    const result = await bridge.injectTranscript('hello');
    expect(result.injected).toBe(false);
    expect(result.source.kind).toBe('voice');
    expect(result.reason).toBe('no-stream');
    expect(submitToSession).not.toHaveBeenCalled();
  });

  test('resolveSession miss can fall back to dictation', async () => {
    const stt = makeFakeSTT('');
    const submitToSession = mock(async () => {});
    const resolveSession = mock(() => null);
    const dictateTranscript = mock(async (_text: string) => true);
    const bridge = createVoiceInputBridge({
      sttProvider: stt,
      resolveSession,
      submitToSession,
      dictateTranscript,
    });
    const result = await bridge.injectTranscript('hello');
    expect(result.injected).toBe(true);
    expect(result.source.kind).toBe('voice');
    expect(result.reason).toBe('dictated');
    expect(result.sessionId).toBeNull();
    expect(dictateTranscript).toHaveBeenCalledWith('hello');
    expect(submitToSession).not.toHaveBeenCalled();
  });
});

// ── handleTranscript (voice-mode 가 호출하는 alias) ──────────────────

describe('PR-S1V.4 · bridge.handleTranscript', () => {
  test('aliases injectTranscript', async () => {
    const stt = makeFakeSTT('');
    const submitToSession = mock(async (_id: string, _text: string) => {});
    const resolveSession = mock(() => ({ sessionId: 'sess' }));
    const bridge = createVoiceInputBridge({
      sttProvider: stt,
      resolveSession,
      submitToSession,
    });
    await bridge.handleTranscript('hello');
    expect(submitToSession).toHaveBeenCalledWith('sess', 'hello');
  });

  test('accepts an explicit default source descriptor', async () => {
    const stt = makeFakeSTT('');
    const submitToSession = mock(async (_id: string, _text: string) => {});
    const resolveSession = mock(() => ({ sessionId: 'sess' }));
    const bridge = createVoiceInputBridge({
      sttProvider: stt,
      resolveSession,
      submitToSession,
      defaultSource: {
        kind: 'voice',
        channel: 'discord',
        surface: 'discord-voice-channel',
        mode: 'voice-channel',
        transcriptSource: 'voice',
      },
    });
    const result = await bridge.injectTranscript('hello');
    expect(result.source).toEqual({
      kind: 'voice',
      channel: 'discord',
      surface: 'discord-voice-channel',
      mode: 'voice-channel',
      transcriptSource: 'voice',
    });
  });
});

// ── PR-S1V.4-wiring · submit failure surface ─────────────────────────

describe('PR-S1V.4-wiring · bridge.injectTranscript — send failure', () => {
  test('submitToSession rejection surfaces via onSendError + result.sendError', async () => {
    const stt = makeFakeSTT('');
    const sendError = new Error('network down');
    const submitToSession = mock(async (_id: string, _text: string) => {
      throw sendError;
    });
    const resolveSession = mock(() => ({ sessionId: 'sess-acp' }));
    const onSendError = mock((_err: Error) => {});
    const bridge = createVoiceInputBridge({
      sttProvider: stt,
      resolveSession,
      submitToSession,
      onSendError,
    });
    const result = await bridge.injectTranscript('hello world');
    expect(result.injected).toBe(true); // user block was echoed (ACP path) — failure is separate surface
    expect(result.sendError).toBe(sendError);
    expect(onSendError).toHaveBeenCalledTimes(1);
    expect(onSendError).toHaveBeenCalledWith(sendError);
  });

  test('onSendError absent — bridge swallows the rejection without throwing', async () => {
    const stt = makeFakeSTT('');
    const submitToSession = mock(async (_id: string, _text: string) => {
      throw new Error('boom');
    });
    const resolveSession = mock(() => ({ sessionId: 'sess' }));
    const bridge = createVoiceInputBridge({
      sttProvider: stt,
      resolveSession,
      submitToSession,
    });
    // Must not reject — bridge owns the catch.
    const result = await bridge.injectTranscript('hi');
    expect(result.sendError).toBeInstanceOf(Error);
    expect(result.injected).toBe(true);
  });
});
