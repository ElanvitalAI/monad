// PR-S1V.7 (sprint 22 Phase 2 · 2026-04-29) — Auto-TTS controller.
//
// Sits between the chat response stream and the audio output device.
// The dashboard's response chunk handler calls `pushChunk(delta)` for
// every incoming chunk, then `commit()` when the LLM signals end-of-
// stream. The controller pulls complete sentences out of the buffer
// (via SentenceSegmenter), feeds them to the configured TTS provider,
// and pushes the resulting PCM into the long-lived audio-player.
//
// Lifecycle (one chat turn):
//
//   pushChunk("월요일에는 ")   → buffered, no boundary yet
//   pushChunk("회의가 있어요.") → "월요일에는 회의가 있어요." → speak
//   pushChunk(" 다음에는 ")     → buffered (space-trim)
//   pushChunk("...")             → ...
//   commit()                    → flushRemainder + drain audio-player
//
// ESC → cancel(): drop the queue, stop the player, reset segmenter.
//
// Streaming-first: TTS providers that expose `synthesizeStream` get
// chunk-by-chunk PCM forwarding (lower first-byte latency). Batch-only
// providers (macos-say · edge-tts) fall back to a single push per
// sentence.

import type { AudioPlayer } from '../../voice/playback/audio-player.js';
import type { TTSProvider } from '../../voice/tts/tts-provider.js';
import { debug } from '../../debug/log.js';
import {
  buildTurnOutputTextBlocks,
} from '../../input/turn-output-block.js';
import { selectTurnOutputTextForSink } from '../../input/turn-output-sink-registry.js';
import { createSentenceSegmenter, type SentenceSegmenter } from './sentence-segmenter.js';

// ── Public types ───────────────────────────────────────────────────

export interface AutoTtsControllerDeps {
  /** Lazy-create the TTS provider on first use. Lets the controller
   *  start in `disabled` state without paying the construction cost
   *  (and without crashing if e.g. OPENAI_API_KEY is unset). */
  createProvider: () => Promise<TTSProvider>;
  /** Lazy-create an AudioPlayer. Same rationale — the player only
   *  spawns sox `play` once a sentence is ready to render. */
  createAudioPlayer: () => AudioPlayer;
  /** Initial enabled state — driven by `ELANOUS_AUTO_TTS=1` env at boot. */
  initiallyEnabled?: boolean;
  /** Hard cap on the segmenter buffer. Default 2000 — set via
   *  `ELANOUS_AUTO_TTS_MAX_LENGTH` at boot. */
  maxSentenceChars?: number;
  /** Optional hook fired whenever enabled-state changes. UI uses this
   *  to update the status indicator. */
  onEnabledChange?: (enabled: boolean) => void;
}

export interface AutoTtsController {
  /** Whether new pushChunks will be enqueued for synthesis. */
  isEnabled(): boolean;
  /** Whether something is currently in the speak loop. */
  isSpeaking(): boolean;
  enable(): void;
  disable(): void;
  /** Toggle, returns the new state. */
  toggle(): boolean;
  /** Append a chat-stream chunk to the segmenter; complete sentences
   *  flow into the speak queue immediately. No-op when disabled. */
  pushChunk(delta: string): void;
  /** Stream finished — flush any unterminated sentence and drain the
   *  audio-player. Resolves when the speaker finishes rendering. */
  commit(): Promise<void>;
  /** ESC / abort — stop the player, drop the queue, reset segmenter. */
  cancel(): Promise<void>;
}

// ── Implementation ─────────────────────────────────────────────────

export function createAutoTtsController(deps: AutoTtsControllerDeps): AutoTtsController {
  const segmenter: SentenceSegmenter = createSentenceSegmenter({
    ...(deps.maxSentenceChars !== undefined ? { maxSentenceChars: deps.maxSentenceChars } : {}),
  });

  let enabled = deps.initiallyEnabled ?? false;
  let queue: string[] = [];
  // `activeSpeak` is non-null exactly while the speak loop is in
  // flight. `commit()` and `cancel()` await it to guarantee the
  // synthesizer has finished before they resolve. Tracking via a
  // Promise (instead of a bool flag) makes the await pattern explicit
  // and avoids polling races.
  let activeSpeak: Promise<void> | null = null;
  let aborted = false;
  let player: AudioPlayer | null = null;
  let cachedProvider: TTSProvider | null = null;

  function setEnabled(v: boolean): void {
    if (enabled === v) return;
    enabled = v;
    if (debug.enabled) debug.log('voice.auto-tts', 'enabled-change', { enabled });
    deps.onEnabledChange?.(v);
  }

  function isEnabled(): boolean { return enabled; }
  function isSpeaking(): boolean { return activeSpeak !== null; }
  function enable(): void { setEnabled(true); }
  function disable(): void {
    setEnabled(false);
    // Drop pending work but keep the in-flight sentence — fully
    // disabling mid-turn is rare; cancel() is the explicit kill switch.
    queue = [];
    segmenter.reset();
  }
  function toggle(): boolean { setEnabled(!enabled); return enabled; }

  function pushChunk(delta: string): void {
    // SCHEME-debug-logging — controller entry trail. The previous
    // instrumentation only logged the SUCCESS path (`enqueue`), so
    // disabled/aborted/no-boundary cases were silent and the user
    // saw "speaking phase but TTS never fires" with no breadcrumb.
    if (debug.enabled)
      debug.log('voice.auto-tts', 'pushChunk', {
        chars: delta.length,
        enabled,
        aborted,
        snippet: delta.slice(0, 40),
      });
    if (!enabled || aborted) return;
    if (delta.length === 0) return;
    const sentences = segmenter.feed(delta);
    if (sentences.length === 0) {
      if (debug.enabled)
        debug.log('voice.auto-tts', 'pushChunk.no-boundary', {
          chars: delta.length,
        });
      return;
    }
    queue.push(...sentences);
    if (debug.enabled)
      debug.log('voice.auto-tts', 'enqueue', {
        added: sentences.length, queueDepth: queue.length,
        firstSnip: sentences[0]?.slice(0, 60),
      });
    void runSpeakLoop();
  }

  async function commit(): Promise<void> {
    if (debug.enabled)
      debug.log('voice.auto-tts', 'commit.begin', {
        enabled, aborted,
        queueDepth: queue.length,
        isSpeaking: activeSpeak !== null,
        hasPlayer: player !== null,
      });
    if (!enabled) return;
    const tail = segmenter.flushRemainder();
    if (tail.length > 0 && !aborted) {
      queue.push(...tail);
      if (debug.enabled)
        debug.log('voice.auto-tts', 'commit.flush-remainder', {
          added: tail.length,
          firstSnip: tail[0]?.slice(0, 60),
        });
    }
    // Drain in-flight speak loop AND any items queued during commit.
    // pushChunk fires `runSpeakLoop()` non-awaiting, so commit must
    // both wait for the existing loop to finish and re-arm it for the
    // tail items it just pushed.
    while (activeSpeak !== null || queue.length > 0) {
      if (activeSpeak) await activeSpeak;
      else await runSpeakLoop();
    }
    if (player) {
      try {
        await player.drain();
      } catch (err) {
        if (debug.enabled) debug.log('voice.auto-tts', 'drain.error', { err: String(err) }, { level: 'error' });
      }
      player = null;
    }
    if (debug.enabled) debug.log('voice.auto-tts', 'commit.done', {});
  }

  async function cancel(): Promise<void> {
    if (debug.enabled)
      debug.log('voice.auto-tts', 'cancel.begin', {
        enabled,
        queueDepth: queue.length,
        isSpeaking: activeSpeak !== null,
        hasPlayer: player !== null,
      });
    aborted = true;
    queue = [];
    segmenter.reset();
    if (player) {
      try {
        await player.stop();
      } catch (err) {
        if (debug.enabled) debug.log('voice.auto-tts', 'cancel.stop-error', { err: String(err) }, { level: 'error' });
      }
      player = null;
    }
    // Wait for any in-flight loop to observe `aborted` and exit.
    if (activeSpeak) {
      try { await activeSpeak; } catch { /* swallow — loop may throw on stop */ }
    }
    aborted = false;
    if (debug.enabled) debug.log('voice.auto-tts', 'cancel.done', {});
  }

  function runSpeakLoop(): Promise<void> {
    if (activeSpeak) return activeSpeak;
    if (debug.enabled)
      debug.log('voice.auto-tts', 'speak.loop.begin', {
        queueDepth: queue.length,
      });
    const promise = (async () => {
      try {
        while (queue.length > 0 && !aborted) {
          const sentence = queue.shift()!;
          await speakSentence(sentence);
        }
      } finally {
        if (debug.enabled)
          debug.log('voice.auto-tts', 'speak.loop.done', {
            remaining: queue.length, aborted,
          });
        activeSpeak = null;
      }
    })();
    activeSpeak = promise;
    return promise;
  }

  async function speakSentence(sentence: string): Promise<void> {
    const speakableSentence = selectTurnOutputTextForSink(
      'audio-tts',
      buildTurnOutputTextBlocks(sentence),
    ) ?? sentence;
    let provider: TTSProvider;
    try {
      provider = await ensureProvider();
    } catch (err) {
      if (debug.enabled)
        debug.log('voice.auto-tts', 'provider.create-error', { err: String(err) }, { level: 'error' });
      return;
    }
    if (!player) {
      player = deps.createAudioPlayer();
      if (debug.enabled)
        debug.log('voice.auto-tts', 'player.start.begin', {
          sampleRate: provider.format.sampleRate,
          channels: provider.format.channels,
          bitsPerSample: provider.format.bitsPerSample,
        });
      const ok = await player.start({
        sampleRate: provider.format.sampleRate,
        channels: provider.format.channels,
        bitsPerSample: provider.format.bitsPerSample,
      });
      if (!ok) {
        if (debug.enabled)
          debug.log('voice.auto-tts', 'player.start-failed', {}, { level: 'error' });
        player = null;
        return;
      }
      if (debug.enabled)
        debug.log('voice.auto-tts', 'player.start.ok', {});
    }
    if (debug.enabled)
      debug.log('voice.auto-tts', 'speak.start', {
        chars: speakableSentence.length,
        providerId: provider.id,
        mode: provider.synthesizeStream ? 'stream' : 'batch',
        snippet: speakableSentence.slice(0, 60),
      });
    try {
      if (provider.synthesizeStream) {
        let chunkIdx = 0;
        let totalBytes = 0;
        for await (const chunk of provider.synthesizeStream(speakableSentence)) {
          if (aborted || !player) {
            if (debug.enabled)
              debug.log('voice.auto-tts', 'speak.stream.break', {
                aborted, hasPlayer: !!player, chunkIdx, totalBytes,
              });
            break;
          }
          if (chunkIdx === 0 && debug.enabled)
            debug.log('voice.auto-tts', 'speak.stream.first-chunk', {
              bytes: chunk.pcm.length,
            });
          player.push(chunk.pcm);
          chunkIdx++;
          totalBytes += chunk.pcm.length;
        }
        if (debug.enabled)
          debug.log('voice.auto-tts', 'speak.stream.done', {
            chunkCount: chunkIdx, totalBytes,
          });
      } else {
        const result = await provider.synthesizeBatch(speakableSentence);
        if (debug.enabled)
          debug.log('voice.auto-tts', 'speak.batch.result', {
            bytes: result.pcm.length,
            charCount: result.charCount,
          });
        if (!aborted && player) player.push(result.pcm);
      }
    } catch (err) {
      if (debug.enabled)
        debug.log('voice.auto-tts', 'speak.error', {
          err: String(err), snippet: speakableSentence.slice(0, 60),
        }, { level: 'error' });
    }
  }

  async function ensureProvider(): Promise<TTSProvider> {
    if (cachedProvider) return cachedProvider;
    if (debug.enabled)
      debug.log('voice.auto-tts', 'provider.create.begin', {});
    const t0 = Date.now();
    try {
      cachedProvider = await deps.createProvider();
      if (debug.enabled)
        debug.log('voice.auto-tts', 'provider.create.ok', {
          providerId: cachedProvider.id,
          format: cachedProvider.format,
          elapsedMs: Date.now() - t0,
        });
      return cachedProvider;
    } catch (err) {
      if (debug.enabled)
        debug.log('voice.auto-tts', 'provider.create.error', {
          err: err instanceof Error ? err.message : String(err),
          elapsedMs: Date.now() - t0,
        }, { level: 'error' });
      throw err;
    }
  }

  return {
    isEnabled,
    isSpeaking,
    enable,
    disable,
    toggle,
    pushChunk,
    commit,
    cancel,
  };
}
