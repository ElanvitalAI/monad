// PR-S1V.14 (sprint 22 §1.2 · 2026-04-30) — PWA TTS bridge tests.
//
// Covers the bridge surface in isolation: pushChunk aggregation, flush
// drives the TTSProvider once and emits PCM, attach/detach lifecycle,
// multi-session isolation, and silent-drop after detach.

import { describe, expect, mock, test } from 'bun:test';
import { createPwaTtsBridge } from '../src/voice/voice-pwa-tts-bridge';
import {
  DEFAULT_TTS_PCM_FORMAT,
  type TTSProvider,
  type TTSResult,
} from '../src/voice/tts/tts-provider';

function fakeTts(): {
  provider: TTSProvider;
  synthesizeBatch: ReturnType<typeof mock>;
} {
  const synthesizeBatch = mock(async (text: string): Promise<TTSResult> => ({
    pcm: Buffer.from(`pcm-for-${text}`),
    format: DEFAULT_TTS_PCM_FORMAT,
    charCount: text.length,
  }));
  const provider: TTSProvider = {
    id: 'openai-tts',
    format: DEFAULT_TTS_PCM_FORMAT,
    synthesizeBatch,
  };
  return { provider, synthesizeBatch };
}

describe('voice-pwa-tts-bridge', () => {
  test('pushChunk buffers tail until a sentence boundary appears', () => {
    const { provider } = fakeTts();
    const bridge = createPwaTtsBridge({ ttsProvider: provider });
    bridge.pushChunk('s1', 'Hello');
    bridge.pushChunk('s1', ', ');
    bridge.pushChunk('s1', 'world');   // no terminator yet
    expect(bridge.__peekBuffer('s1')).toBe('Hello, world');
  });

  test('flush synthesizes the remainder and emits one PCM frame when no sentence boundary', async () => {
    const { provider, synthesizeBatch } = fakeTts();
    const bridge = createPwaTtsBridge({ ttsProvider: provider });
    const frames: Buffer[] = [];
    bridge.attach('s1', (f) => frames.push(f.pcm));
    bridge.pushChunk('s1', 'one ');
    bridge.pushChunk('s1', 'shot');     // no terminator → stays in buffer
    await bridge.flush('s1');
    expect(synthesizeBatch).toHaveBeenCalledTimes(1);
    expect(synthesizeBatch.mock.calls[0]?.[0]).toBe('one shot');
    expect(frames).toHaveLength(1);
    expect(frames[0]?.toString('utf8')).toBe('pcm-for-one shot');
    // Buffer is drained after flush.
    expect(bridge.__peekBuffer('s1')).toBe('');
  });

  test('flush is a no-op when no emitter is attached', async () => {
    const { provider, synthesizeBatch } = fakeTts();
    const bridge = createPwaTtsBridge({ ttsProvider: provider });
    bridge.pushChunk('s1', 'orphan');
    await bridge.flush('s1');
    expect(synthesizeBatch).not.toHaveBeenCalled();
  });

  test('flush is a no-op for an unknown session', async () => {
    const { provider, synthesizeBatch } = fakeTts();
    const bridge = createPwaTtsBridge({ ttsProvider: provider });
    await bridge.flush('never-seen');
    expect(synthesizeBatch).not.toHaveBeenCalled();
  });

  test('detach drops pending buffer and any subsequent chunk routes nowhere', async () => {
    const { provider, synthesizeBatch } = fakeTts();
    const bridge = createPwaTtsBridge({ ttsProvider: provider });
    const frames: Buffer[] = [];
    bridge.attach('s1', (f) => frames.push(f.pcm));
    bridge.pushChunk('s1', 'half-typed');
    bridge.detach('s1');
    // Re-pushing after detach starts a fresh state but no emitter is
    // attached, so flush emits nothing.
    bridge.pushChunk('s1', 'rebound');
    await bridge.flush('s1');
    expect(synthesizeBatch).not.toHaveBeenCalled();
    expect(frames).toHaveLength(0);
  });

  test('multi-session isolation — chunks and emit targets are kept separate', async () => {
    const { provider } = fakeTts();
    const bridge = createPwaTtsBridge({ ttsProvider: provider });
    const a: Buffer[] = [];
    const b: Buffer[] = [];
    bridge.attach('a', (f) => a.push(f.pcm));
    bridge.attach('b', (f) => b.push(f.pcm));
    bridge.pushChunk('a', 'alpha');
    bridge.pushChunk('b', 'bravo');
    await Promise.all([bridge.flush('a'), bridge.flush('b')]);
    expect(a[0]?.toString('utf8')).toBe('pcm-for-alpha');
    expect(b[0]?.toString('utf8')).toBe('pcm-for-bravo');
  });

  // ── Sentence-streaming behaviour ─────────────────────────────────

  test('sentence boundary inside pushChunk dispatches synth immediately (mid-stream playback)', async () => {
    const { provider, synthesizeBatch } = fakeTts();
    const bridge = createPwaTtsBridge({ ttsProvider: provider });
    const frames: Buffer[] = [];
    bridge.attach('s1', (f) => frames.push(f.pcm));
    // Two complete sentences arriving in a single chunk.
    bridge.pushChunk('s1', '안녕하세요. 무엇을 도와드릴까요?');
    // Wait for the synth queue tail.
    await bridge.flush('s1');
    expect(synthesizeBatch).toHaveBeenCalledTimes(2);
    expect(synthesizeBatch.mock.calls[0]?.[0]).toBe('안녕하세요.');
    expect(synthesizeBatch.mock.calls[1]?.[0]).toBe('무엇을 도와드릴까요?');
    expect(frames).toHaveLength(2);
  });

  test('multi-chunk stream with mid-chunk sentence boundary — frames emit in order', async () => {
    const { provider, synthesizeBatch } = fakeTts();
    const bridge = createPwaTtsBridge({ ttsProvider: provider });
    const frames: string[] = [];
    bridge.attach('s1', (f) => frames.push(f.pcm.toString('utf8')));

    // Mimic an LLM stream chunked at arbitrary character boundaries.
    bridge.pushChunk('s1', 'First');
    bridge.pushChunk('s1', ' sentence. Second ');
    bridge.pushChunk('s1', 'sentence! Third');     // tail uncommitted
    await bridge.flush('s1');

    expect(synthesizeBatch).toHaveBeenCalledTimes(3);
    expect(synthesizeBatch.mock.calls[0]?.[0]).toBe('First sentence.');
    expect(synthesizeBatch.mock.calls[1]?.[0]).toBe('Second sentence!');
    expect(synthesizeBatch.mock.calls[2]?.[0]).toBe('Third');
    // Order preserved at the emit layer (synth queue is serialized).
    expect(frames).toEqual([
      'pcm-for-First sentence.',
      'pcm-for-Second sentence!',
      'pcm-for-Third',
    ]);
  });

  test('maxBufferChars failsafe forces a synth even without a terminator', async () => {
    const { provider, synthesizeBatch } = fakeTts();
    const bridge = createPwaTtsBridge({
      ttsProvider: provider,
      maxBufferChars: 12,
    });
    bridge.attach('s1', () => {});
    // 12-char chunk hits the threshold exactly.
    bridge.pushChunk('s1', 'noterminator');
    // Wait a microtask so the queued synth runs.
    await bridge.flush('s1');
    expect(synthesizeBatch).toHaveBeenCalled();
    expect(synthesizeBatch.mock.calls[0]?.[0]).toBe('noterminator');
  });

  test('detach mid-synth cancels the pending PCM emit', async () => {
    let resolveBatch: ((r: TTSResult) => void) | null = null;
    const synthesizeBatch = mock((_: string): Promise<TTSResult> =>
      new Promise<TTSResult>((res) => { resolveBatch = res; }));
    const provider: TTSProvider = {
      id: 'openai-tts',
      format: DEFAULT_TTS_PCM_FORMAT,
      synthesizeBatch: synthesizeBatch as unknown as TTSProvider['synthesizeBatch'],
    };
    const bridge = createPwaTtsBridge({ ttsProvider: provider });
    const frames: Buffer[] = [];
    bridge.attach('s1', (f) => frames.push(f.pcm));
    bridge.pushChunk('s1', 'hello.');
    // Yield so the synth queue advances and synthesizeBatch is invoked
    // (the in-flight Promise is held by `resolveBatch`).
    await Promise.resolve();
    await Promise.resolve();
    expect(resolveBatch).not.toBeNull();
    expect(synthesizeBatch).toHaveBeenCalledTimes(1);
    // Detach mid-synth.
    bridge.detach('s1');
    // Resolve the synth — synthOne resumes, detects detached, returns
    // without emitting.
    resolveBatch!({
      pcm: Buffer.from('late-pcm'),
      format: DEFAULT_TTS_PCM_FORMAT,
      charCount: 6,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(frames).toHaveLength(0);
  });

  test('TTS provider failure is swallowed without throwing', async () => {
    const synthesizeBatch = mock(async (): Promise<TTSResult> => {
      throw new Error('upstream tts unavailable');
    });
    const provider: TTSProvider = {
      id: 'openai-tts',
      format: DEFAULT_TTS_PCM_FORMAT,
      synthesizeBatch: synthesizeBatch as unknown as TTSProvider['synthesizeBatch'],
    };
    const bridge = createPwaTtsBridge({ ttsProvider: provider });
    let emitCalls = 0;
    bridge.attach('s1', () => { emitCalls += 1; });
    bridge.pushChunk('s1', 'will fail');
    await bridge.flush('s1');
    expect(emitCalls).toBe(0);
    // Buffer is drained even on error so a stuck-buffer doesn't leak.
    expect(bridge.__peekBuffer('s1')).toBe('');
  });

  test('uses speakable variants before PWA synth', async () => {
    const { provider, synthesizeBatch } = fakeTts();
    const bridge = createPwaTtsBridge({ ttsProvider: provider });
    bridge.attach('s1', () => {});
    bridge.pushChunk('s1', '경로는 /tmp/demotxt 이고 `const x = 1` 입니다.');
    await bridge.flush('s1');
    expect(synthesizeBatch).toHaveBeenCalledTimes(1);
    expect(synthesizeBatch.mock.calls[0]?.[0]).toBe('경로는 path 이고 const x = 1 입니다.');
  });
});
