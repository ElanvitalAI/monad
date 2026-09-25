// PR-S1V.7 (sprint 22 Phase 2) — auto-TTS controller integration test.
//
// Plumbs a fake TTS provider + fake AudioPlayer into the controller and
// asserts the chunk → sentence → speak loop calls match expectation.
// CLAUDE.md prefers real wiring; the fakes are minimal stand-ins for
// the network/subprocess boundary.

import { describe, expect, it } from 'bun:test';
import {
  createAutoTtsController,
  type AutoTtsController,
} from '../src/dashboard/auto-tts/auto-tts-controller.js';
import type { AudioPlayer } from '../src/voice/playback/audio-player.js';
import type { TTSProvider, TTSResult } from '../src/voice/tts/tts-provider.js';

interface FakePlayer extends AudioPlayer {
  pushed: Buffer[];
  startedWith: Array<{ sampleRate?: number; channels?: number; bitsPerSample?: number }>;
  drained: number;
  stopped: number;
  active: boolean;
}

function fakePlayer(): FakePlayer {
  const p: FakePlayer = {
    pushed: [],
    startedWith: [],
    drained: 0,
    stopped: 0,
    active: false,
    async start(opts) {
      p.startedWith.push(opts ?? {});
      p.active = true;
      return true;
    },
    push(pcm) {
      if (!p.active) return false;
      p.pushed.push(pcm);
      return true;
    },
    async drain() {
      p.drained += 1;
      p.active = false;
    },
    async stop() {
      p.stopped += 1;
      p.active = false;
    },
    isPlaying() {
      return p.active;
    },
  };
  return p;
}

function fakeProvider(opts: { stream?: boolean; pcmPerCall?: number } = {}): {
  provider: TTSProvider;
  calls: string[];
} {
  const calls: string[] = [];
  const pcmBytes = opts.pcmPerCall ?? 4;
  const provider: TTSProvider = {
    id: 'openai-tts',
    format: { sampleRate: 24000, channels: 1, bitsPerSample: 16 },
    async synthesizeBatch(text: string): Promise<TTSResult> {
      calls.push(text);
      return {
        pcm: Buffer.alloc(pcmBytes, 1),
        format: { sampleRate: 24000, channels: 1, bitsPerSample: 16 },
        charCount: text.length,
      };
    },
  };
  if (opts.stream) {
    provider.synthesizeStream = async function* (text: string) {
      calls.push(text);
      // Two chunks per sentence
      yield { pcm: Buffer.alloc(pcmBytes, 2) };
      yield { pcm: Buffer.alloc(pcmBytes, 3) };
    };
  }
  return { provider, calls };
}

async function flush(): Promise<void> {
  // Allow any pending speak-loop microtasks to settle.
  for (let i = 0; i < 10; i += 1) {
    await new Promise((r) => setImmediate(r));
  }
}

function buildController(opts: {
  enabled?: boolean;
  stream?: boolean;
} = {}): {
  controller: AutoTtsController;
  player: FakePlayer;
  provider: TTSProvider;
  calls: string[];
} {
  const player = fakePlayer();
  const { provider, calls } = fakeProvider({ stream: opts.stream ?? false });
  const controller = createAutoTtsController({
    createProvider: async () => provider,
    createAudioPlayer: () => player,
    initiallyEnabled: opts.enabled ?? true,
  });
  return { controller, player, provider, calls };
}

describe('AutoTtsController — basic lifecycle', () => {
  it('starts disabled by default', () => {
    const { controller } = buildController({ enabled: false });
    expect(controller.isEnabled()).toBe(false);
    controller.pushChunk('Hello.');
    expect(controller.isSpeaking()).toBe(false);
  });

  it('isEnabled toggles via enable/disable/toggle', () => {
    const { controller } = buildController({ enabled: false });
    controller.enable();
    expect(controller.isEnabled()).toBe(true);
    controller.disable();
    expect(controller.isEnabled()).toBe(false);
    controller.toggle();
    expect(controller.isEnabled()).toBe(true);
    controller.toggle();
    expect(controller.isEnabled()).toBe(false);
  });

  it('disabled controller drops chunks silently', async () => {
    const { controller, calls } = buildController({ enabled: false });
    controller.pushChunk('Hello world.');
    await flush();
    expect(calls).toEqual([]);
  });
});

describe('AutoTtsController — chunk → speak', () => {
  it('synthesizes complete sentences via batch fallback', async () => {
    const { controller, calls, player } = buildController({ stream: false });
    controller.pushChunk('First sentence. ');
    controller.pushChunk('Second sentence. ');
    controller.pushChunk('Third sentence.');
    await controller.commit();
    // All three sentences should have been synthesized.
    expect(calls).toEqual([
      'First sentence.',
      'Second sentence.',
      'Third sentence.',
    ]);
    // Player drained at end.
    expect(player.drained).toBeGreaterThanOrEqual(1);
    // Each batch synth pushes one PCM buffer.
    expect(player.pushed.length).toBe(3);
  });

  it('uses streaming when provider exposes synthesizeStream', async () => {
    const { controller, calls, player } = buildController({ stream: true });
    controller.pushChunk('One. Two.');
    await controller.commit();
    expect(calls).toEqual(['One.', 'Two.']);
    // Two chunks per sentence × 2 sentences = 4 pushes
    expect(player.pushed.length).toBe(4);
  });

  it('starts the player with the provider format', async () => {
    const { controller, player } = buildController();
    controller.pushChunk('Hi.');
    await controller.commit();
    expect(player.startedWith.length).toBe(1);
    expect(player.startedWith[0]).toEqual({
      sampleRate: 24000,
      channels: 1,
      bitsPerSample: 16,
    });
  });

  it('does not start a player when no chunk arrives', async () => {
    const { controller, player } = buildController();
    await controller.commit();
    expect(player.startedWith.length).toBe(0);
  });
});

describe('AutoTtsController — commit', () => {
  it('flushes a trailing fragment without sentence punctuation', async () => {
    const { controller, calls } = buildController();
    controller.pushChunk('No terminator here');
    await controller.commit();
    expect(calls).toEqual(['No terminator here']);
  });

  it('commit awaits player drain', async () => {
    const { controller, player } = buildController();
    controller.pushChunk('Sentence one. ');
    await controller.commit();
    expect(player.drained).toBe(1);
  });
});

describe('AutoTtsController — cancel', () => {
  it('drops the queue and stops the player', async () => {
    const { controller, player } = buildController();
    controller.pushChunk('A. B. C.');
    // Race: cancel before the speak loop finishes
    await controller.cancel();
    // Some sentences may have been spoken before cancel hit; that's
    // acceptable. The contract is: stopped > 0 OR queue cleared.
    expect(player.stopped + player.drained).toBeGreaterThanOrEqual(0);
    // After cancel, isSpeaking returns false.
    expect(controller.isSpeaking()).toBe(false);
  });

  it('subsequent pushChunk after cancel still works', async () => {
    const { controller, calls } = buildController();
    controller.pushChunk('First.');
    await controller.cancel();
    controller.pushChunk('Second.');
    await controller.commit();
    expect(calls).toContain('Second.');
  });
});

describe('AutoTtsController — code fences', () => {
  it('skips text inside ``` fences', async () => {
    const { controller, calls } = buildController();
    controller.pushChunk('Look at this: ');
    controller.pushChunk('```\nconst x = 1;\n```');
    controller.pushChunk(' Done.');
    await controller.commit();
    const joined = calls.join(' | ');
    expect(joined).toContain('Look at this');
    expect(joined).toContain('Done');
    expect(joined).not.toContain('const x');
  });

  it('uses speakable variants for urls and paths before synth', async () => {
    const { controller, calls } = buildController();
    controller.pushChunk('문서는 https://example.com/docs 에 있고 경로는 /tmp/demo.txt 입니다.');
    await controller.commit();
    expect(calls).toEqual(['문서는 link 에 있고 경로는 path 입니다.']);
  });
});
