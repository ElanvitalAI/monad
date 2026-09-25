// PR-S1V.16 (sprint 22 §B · 2026-04-30) — PWA voice onFinalTranscript
// dispatcher tests.
//
// Covers all branches of `dispatchPwaFinalTranscript` with fakes for
// the daemon history + LLM stream + TTS bridge. End-to-end (real
// runtime + browser) is exercised via the dogfood macro in the §A/§B/§C
// HANDOFF doc.

import { describe, expect, mock, test } from 'bun:test';
import {
  dispatchPwaFinalTranscript,
  type PwaDispatchHistory,
} from '../src/voice/voice-pwa-dispatch';
import {
  createPwaTtsBridge,
  type PwaTtsBridge,
} from '../src/voice/voice-pwa-tts-bridge';
import {
  DEFAULT_TTS_PCM_FORMAT,
  type TTSProvider,
  type TTSResult,
} from '../src/voice/tts/tts-provider';
import type { LLMMessage } from '../src/llm';

function fakeHistory(): {
  history: PwaDispatchHistory;
  state: Map<string, LLMMessage[]>;
} {
  const state = new Map<string, LLMMessage[]>();
  const history: PwaDispatchHistory = {
    has: (id) => state.has(id),
    register: (id, seed = []) => {
      if (!state.has(id)) state.set(id, [...seed]);
    },
    get: (id) => state.get(id) ?? [],
    append: (id, msgs) => {
      const cur = state.get(id) ?? [];
      state.set(id, [...cur, ...msgs]);
    },
  };
  return { history, state };
}

function fakeBridge(): {
  bridge: PwaTtsBridge;
  emitted: Buffer[];
  synthesizeBatch: ReturnType<typeof mock>;
} {
  const synthesizeBatch = mock(async (text: string): Promise<TTSResult> => ({
    pcm: Buffer.from(`pcm:${text}`),
    format: DEFAULT_TTS_PCM_FORMAT,
    charCount: text.length,
  }));
  const provider: TTSProvider = {
    id: 'openai-tts',
    format: DEFAULT_TTS_PCM_FORMAT,
    synthesizeBatch,
  };
  const bridge = createPwaTtsBridge({ ttsProvider: provider });
  const emitted: Buffer[] = [];
  return { bridge, emitted, synthesizeBatch };
}

function chunkingLlm(reply: string, chunks = 3) {
  return mock(async (
    _msgs: LLMMessage[],
    onChunk: (delta: string, full: string) => void,
  ): Promise<string> => {
    const size = Math.ceil(reply.length / chunks);
    let full = '';
    for (let i = 0; i < reply.length; i += size) {
      const delta = reply.slice(i, i + size);
      full += delta;
      onChunk(delta, full);
    }
    return full;
  });
}

describe('dispatchPwaFinalTranscript', () => {
  test('daemon-direct happy path: registers session, streams LLM, persists turn, flushes bridge', async () => {
    const { history, state } = fakeHistory();
    const { bridge, emitted, synthesizeBatch } = fakeBridge();
    bridge.attach('s1', (f) => emitted.push(f.pcm));
    const llmStream = chunkingLlm('안녕하세요, 무엇을 도와드릴까요?', 4);

    const out = await dispatchPwaFinalTranscript('s1', '안녕', 'daemon-direct', {
      history, ttsBridge: bridge, llmStream,
    });

    expect(out.dispatched).toBe(true);
    expect(out.responseChars).toBe('안녕하세요, 무엇을 도와드릴까요?'.length);
    expect(state.get('s1')?.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(state.get('s1')?.[1]?.content).toBe('안녕하세요, 무엇을 도와드릴까요?');
    expect(synthesizeBatch).toHaveBeenCalledTimes(1);
    expect(synthesizeBatch.mock.calls[0]?.[0]).toBe('안녕하세요, 무엇을 도와드릴까요?');
    expect(emitted.length).toBe(1);
    expect(emitted[0]?.toString('utf8')).toBe('pcm:안녕하세요, 무엇을 도와드릴까요?');
  });

  test('daemon-direct uses prior history when present', async () => {
    const { history, state } = fakeHistory();
    state.set('s1', [
      { role: 'system', content: 'you are concise' },
      { role: 'user', content: '이전 발화' },
      { role: 'assistant', content: '이전 응답' },
    ]);
    const { bridge } = fakeBridge();
    bridge.attach('s1', () => {});
    const seenMessages: LLMMessage[][] = [];
    const llmStream = mock(async (
      msgs: LLMMessage[],
      onChunk: (delta: string, full: string) => void,
    ): Promise<string> => {
      seenMessages.push(msgs);
      onChunk('네', '네');
      return '네';
    });

    await dispatchPwaFinalTranscript('s1', '이어서 답해줘', 'daemon-direct', {
      history, ttsBridge: bridge, llmStream,
    });

    expect(seenMessages[0]?.map((m) => m.role)).toEqual([
      'system', 'user', 'assistant', 'user',
    ]);
    expect(seenMessages[0]?.[seenMessages[0]!.length - 1]?.content).toBe('이어서 답해줘');
  });

  test('daemon-direct seeds systemPrompt on first session register', async () => {
    const { history, state } = fakeHistory();
    const { bridge } = fakeBridge();
    bridge.attach('s1', () => {});
    const llmStream = chunkingLlm('ok', 1);

    await dispatchPwaFinalTranscript('s1', '안녕', 'daemon-direct', {
      history, ttsBridge: bridge, llmStream,
      systemPrompt: 'You are a Korean voice assistant.',
    });

    const tail = state.get('s1') ?? [];
    expect(tail[0]?.role).toBe('system');
    expect(tail[0]?.content).toBe('You are a Korean voice assistant.');
  });

  test('tui-bridge mode without voiceInputHost short-circuits as not-wired', async () => {
    const { history, state } = fakeHistory();
    const { bridge, synthesizeBatch } = fakeBridge();
    const llmStream = mock(async () => 'should not run');

    const out = await dispatchPwaFinalTranscript('s1', '안녕', 'tui-bridge', {
      history, ttsBridge: bridge, llmStream,
      // getVoiceInputHost intentionally omitted.
    });

    expect(out.dispatched).toBe(false);
    expect(out.skippedReason).toBe('tui-bridge-not-wired');
    expect(llmStream).not.toHaveBeenCalled();
    expect(synthesizeBatch).not.toHaveBeenCalled();
    expect(state.has('s1')).toBe(false);
  });

  test('tui-bridge mode with wired host calls dictateTranscript and skips LLM', async () => {
    const { history, state } = fakeHistory();
    const { bridge, synthesizeBatch } = fakeBridge();
    const llmStream = mock(async () => 'should not run');
    const dictateCalls: string[] = [];
    const host = {
      dictateTranscript: (t: string) => { dictateCalls.push(t); return true; },
    };

    const out = await dispatchPwaFinalTranscript('s1', '  hello there  ', 'tui-bridge', {
      history, ttsBridge: bridge, llmStream,
      getVoiceInputHost: () => host,
    });

    expect(out.dispatched).toBe(true);
    expect(out.skippedReason).toBeUndefined();
    expect(dictateCalls).toEqual(['hello there']);  // trimmed
    expect(llmStream).not.toHaveBeenCalled();
    expect(synthesizeBatch).not.toHaveBeenCalled();
    expect(state.has('s1')).toBe(false); // no history append in tui-bridge
  });

  test('tui-bridge mode with host returning false marks no-input-target', async () => {
    const { history } = fakeHistory();
    const { bridge } = fakeBridge();
    const llmStream = mock(async () => 'should not run');
    const host = { dictateTranscript: (_t: string) => false };

    const out = await dispatchPwaFinalTranscript('s1', '안녕', 'tui-bridge', {
      history, ttsBridge: bridge, llmStream,
      getVoiceInputHost: () => host,
    });

    expect(out.dispatched).toBe(false);
    expect(out.skippedReason).toBe('tui-bridge-no-input-target');
  });

  test('tui-bridge dictate error is swallowed and reported', async () => {
    const { history } = fakeHistory();
    const { bridge } = fakeBridge();
    const llmStream = mock(async () => 'should not run');
    const host = {
      dictateTranscript: () => { throw new Error('UI bug'); },
    };

    const out = await dispatchPwaFinalTranscript('s1', 'x', 'tui-bridge', {
      history, ttsBridge: bridge, llmStream,
      getVoiceInputHost: () => host,
    });

    expect(out.dispatched).toBe(false);
    expect(out.skippedReason).toBe('tui-bridge-dictate-error');
    expect(llmStream).not.toHaveBeenCalled();
  });

  test('tui-bridge supports async dictateTranscript', async () => {
    const { history } = fakeHistory();
    const { bridge } = fakeBridge();
    const llmStream = mock(async () => 'should not run');
    const host = {
      dictateTranscript: async (_t: string) => true,
    };

    const out = await dispatchPwaFinalTranscript('s1', 'async', 'tui-bridge', {
      history, ttsBridge: bridge, llmStream,
      getVoiceInputHost: () => host,
    });

    expect(out.dispatched).toBe(true);
  });

  test('empty transcript skips dispatch', async () => {
    const { history } = fakeHistory();
    const { bridge } = fakeBridge();
    const llmStream = mock(async () => 'should not run');

    const out = await dispatchPwaFinalTranscript('s1', '   ', 'daemon-direct', {
      history, ttsBridge: bridge, llmStream,
    });

    expect(out.dispatched).toBe(false);
    expect(out.skippedReason).toBe('empty-transcript');
    expect(llmStream).not.toHaveBeenCalled();
  });

  test('null ttsBridge: turn still dispatches, history still updates, no synth', async () => {
    const { history, state } = fakeHistory();
    const llmStream = chunkingLlm('reply', 2);

    const out = await dispatchPwaFinalTranscript('s1', '안녕', 'daemon-direct', {
      history, ttsBridge: null, llmStream,
    });

    expect(out.dispatched).toBe(true);
    expect(out.skippedReason).toBe('no-tts-bridge');
    expect(state.get('s1')?.length).toBe(2);
  });

  test('emitAssistantChunk is invoked for each non-empty LLM delta', async () => {
    const { history } = fakeHistory();
    const { bridge } = fakeBridge();
    bridge.attach('s1', () => {});
    const llmStream = chunkingLlm('안녕하세요', 3);
    const chunks: Array<[string, string]> = [];

    await dispatchPwaFinalTranscript('s1', '안녕', 'daemon-direct', {
      history, ttsBridge: bridge, llmStream,
      emitAssistantChunk: (sid, c) => chunks.push([sid, c]),
    });

    // 3 deltas (chunkingLlm splits the response into 3 pieces).
    expect(chunks.length).toBe(3);
    expect(chunks.every((c) => c[0] === 's1')).toBe(true);
    expect(chunks.map((c) => c[1]).join('')).toBe('안녕하세요');
  });

  test('emitAssistantChunk error is isolated — turn still completes', async () => {
    const { history, state } = fakeHistory();
    const { bridge } = fakeBridge();
    bridge.attach('s1', () => {});
    const llmStream = chunkingLlm('reply', 2);

    const out = await dispatchPwaFinalTranscript('s1', '안녕', 'daemon-direct', {
      history, ttsBridge: bridge, llmStream,
      emitAssistantChunk: () => { throw new Error('ws gone'); },
    });

    expect(out.dispatched).toBe(true);
    expect(state.get('s1')?.length).toBe(2);
  });

  test('emitAssistantChunk keeps raw text for pwa fan-out even when speakable rewrite exists', async () => {
    const { history } = fakeHistory();
    const { bridge } = fakeBridge();
    bridge.attach('s1', () => {});
    const llmStream = mock(async (
      _msgs: LLMMessage[],
      onChunk: (delta: string, full: string) => void,
    ): Promise<string> => {
      const delta = '경로는 /tmp/demotxt 입니다.';
      onChunk(delta, delta);
      return delta;
    });
    const chunks: string[] = [];

    await dispatchPwaFinalTranscript('s1', '안녕', 'daemon-direct', {
      history, ttsBridge: bridge, llmStream,
      emitAssistantChunk: (_sid, c) => chunks.push(c),
    });

    expect(chunks).toEqual(['경로는 /tmp/demotxt 입니다.']);
  });

  test('LLM error is swallowed — outcome reports skipped, history is not corrupted', async () => {
    const { history, state } = fakeHistory();
    const { bridge } = fakeBridge();
    bridge.attach('s1', () => {});
    const llmStream = mock(async () => { throw new Error('upstream 5xx'); });

    const out = await dispatchPwaFinalTranscript('s1', '안녕', 'daemon-direct', {
      history, ttsBridge: bridge, llmStream,
    });

    expect(out.dispatched).toBe(false);
    expect(out.skippedReason).toBe('llm-error');
    // Session got registered, but no user/assistant pair landed.
    expect(state.get('s1')?.length ?? 0).toBe(0);
  });
});
