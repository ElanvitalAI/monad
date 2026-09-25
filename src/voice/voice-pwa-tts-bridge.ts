// PR-S1V.14 (sprint 22 §1.2 · 2026-04-30) — PWA TTS bridge.
//
// Routes assistant response text from the daemon's `runTurn` flow back
// to a connected browser via the PwaVoiceSession's downstream PCM
// channel. The bridge owns:
//
//   1. Sentence-aware text aggregation per session — we synthesise on
//      every sentence boundary so the user hears the start of the
//      response while the LLM is still streaming the rest.
//   2. Calling the configured TTSProvider per sentence, serialised per
//      session (so PCM chunks arrive at the browser in the same order
//      the LLM emitted the text).
//   3. Forwarding the resulting PCM through `session.emitDownstream`
//      style helper that callers wire (the production wired session in
//      `pwa-voice-adapter.ts` exposes `emitDownstream` since §C).
//
// Why a separate module: keeps the adapter contract tight (the adapter
// only knows about transport frames, not chat synthesis). Mirrors the
// dashboard auto-TTS controller's separation of concerns.
//
// Reference: ROADMAP-voice-harness-bidirectional §8.2.
//
// 2026-04-30 update: replaced synth-on-flush with sentence-streaming.
// pushChunk extracts complete sentences from the rolling buffer and
// dispatches them to a per-session synth queue; flush waits for the
// queue to drain (so the daemon-direct loop doesn't return before
// the user has heard the whole response).

import { debug } from '../debug/log.js';
import {
  buildTurnOutputTextBlocks,
} from '../input/turn-output-block.js';
import { selectTurnOutputTextForSink } from '../input/turn-output-sink-registry.js';
import type { TTSProvider } from './tts/tts-provider.js';

/** What the bridge emits per chunk on the downstream side. Matches
 *  PwaDownstreamFrame so callers can forward without a copy. */
export interface PwaTtsBridgeFrame {
  pcm: Buffer;
}

/** Subscriber the daemon registers per active PWA session — invoked
 *  with each PCM chunk the bridge wants the browser to play. The
 *  daemon hooks this up to `session.emitDownstream` (or whatever the
 *  adapter exposes for server-side PCM emission). */
export type PwaTtsBridgeEmit = (frame: PwaTtsBridgeFrame) => void;

export interface PwaTtsBridge {
  /** Append a streaming text chunk for a session's current turn. The
   *  bridge buffers until the next sentence boundary, then dispatches
   *  the complete sentence to the synth queue immediately so playback
   *  can start mid-stream. */
  pushChunk(sessionId: string, chunk: string): void;
  /** Mark turn end — synthesise any remainder in the buffer and wait
   *  for the synth queue to fully drain. No-op when the session is
   *  unknown / detached. */
  flush(sessionId: string): Promise<void>;
  /** Register a session so chunks find their PCM emit target. Idempotent
   *  — re-attaching swaps the emitter. */
  attach(sessionId: string, emit: PwaTtsBridgeEmit): void;
  /** Drop a session — removes the emitter and discards any pending
   *  buffer + queued synths. Safe to call even if sessionId is unknown. */
  detach(sessionId: string): void;
  /** Test seam — current rolling buffer (text not yet committed to a
   *  sentence). */
  __peekBuffer(sessionId: string): string;
}

export interface PwaTtsBridgeOpts {
  ttsProvider: TTSProvider;
  /** Optional voice override forwarded to `synthesizeBatch`. */
  voice?: string;
  /** Optional language hint forwarded to TTS. */
  language?: string;
  /** Force a sentence flush once the rolling buffer reaches this
   *  length even if no sentence-terminator has appeared. Prevents the
   *  user from waiting forever when the LLM emits a long
   *  comma-separated reply with no period. Default 80 chars. */
  maxBufferChars?: number;
}

interface SessionState {
  buffer: string;
  emit: PwaTtsBridgeEmit | null;
  /** Tail of the synth queue — chained promise that holds the order
   *  guarantee. New synths attach via `.then(...)`. */
  queueTail: Promise<void>;
  /** Detach marker — set when the session is dropped so in-flight
   *  synth callbacks can short-circuit. */
  detached: boolean;
}

const SENTENCE_END_RE = /[.!?。！？]+\s*/g;
const DEFAULT_MAX_BUFFER_CHARS = 80;

/** Pull complete sentences out of `text`, return them + remainder. */
function extractSentences(text: string): { sentences: string[]; remainder: string } {
  const sentences: string[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  SENTENCE_END_RE.lastIndex = 0;
  while ((m = SENTENCE_END_RE.exec(text)) !== null) {
    const end = m.index + m[0].length;
    const piece = text.slice(last, end).trim();
    if (piece) sentences.push(piece);
    last = end;
  }
  return { sentences, remainder: text.slice(last) };
}

export function createPwaTtsBridge(opts: PwaTtsBridgeOpts): PwaTtsBridge {
  const sessions = new Map<string, SessionState>();
  const maxBufferChars = opts.maxBufferChars ?? DEFAULT_MAX_BUFFER_CHARS;

  function getOrCreate(sessionId: string): SessionState {
    let s = sessions.get(sessionId);
    if (!s) {
      s = {
        buffer: '',
        emit: null,
        queueTail: Promise.resolve(),
        detached: false,
      };
      sessions.set(sessionId, s);
    }
    return s;
  }

  /** Synthesize one sentence and emit its PCM. Errors are swallowed
   *  so a bad sentence can't kill the queue. */
  async function synthOne(s: SessionState, sessionId: string, sentence: string): Promise<void> {
    if (s.detached) return;
    const trimmed = sentence.trim();
    if (!trimmed) return;
    const speakableText = selectTurnOutputTextForSink(
      'audio-tts',
      buildTurnOutputTextBlocks(trimmed),
    ) ?? trimmed;
    if (!s.emit) {
      if (debug.enabled) {
        debug.log('voice.pwa.tts-bridge', 'synth.no-emitter', {
          sessionId, chars: trimmed.length,
        });
      }
      return;
    }
    const emit = s.emit;
    const synthOpts: { voice?: string; language?: string } = {};
    if (opts.voice !== undefined) synthOpts.voice = opts.voice;
    if (opts.language !== undefined) synthOpts.language = opts.language;
    try {
      const result = await opts.ttsProvider.synthesizeBatch(speakableText, synthOpts);
      if (s.detached) return;
      if (debug.enabled) {
        debug.log('voice.pwa.tts-bridge', 'synth.ok', {
          sessionId, chars: speakableText.length, bytes: result.pcm.length,
        });
      }
      emit({ pcm: result.pcm });
    } catch (err) {
      if (debug.enabled) {
        debug.log('voice.pwa.tts-bridge', 'synth.error', {
          sessionId, err: err instanceof Error ? err.message : String(err),
        }, { level: 'error' });
      }
    }
  }

  function enqueueSentence(s: SessionState, sessionId: string, sentence: string): void {
    s.queueTail = s.queueTail.then(() => synthOne(s, sessionId, sentence));
  }

  function flushSentenceBoundaries(s: SessionState, sessionId: string): void {
    const { sentences, remainder } = extractSentences(s.buffer);
    s.buffer = remainder;
    for (const sentence of sentences) {
      enqueueSentence(s, sessionId, sentence);
    }
    // Failsafe — if the LLM emits a very long sentence with no
    // terminator, force a synth at maxBufferChars so the user starts
    // hearing audio before the whole turn finishes.
    if (s.buffer.length >= maxBufferChars) {
      const forced = s.buffer;
      s.buffer = '';
      enqueueSentence(s, sessionId, forced);
      if (debug.enabled) {
        debug.log('voice.pwa.tts-bridge', 'force-flush', {
          sessionId, chars: forced.length,
        });
      }
    }
  }

  function pushChunk(sessionId: string, chunk: string): void {
    if (!chunk) return;
    const s = getOrCreate(sessionId);
    s.buffer += chunk;
    if (debug.enabled) {
      debug.log('voice.pwa.tts-bridge', 'push', {
        sessionId,
        chunkLen: chunk.length,
        bufferLen: s.buffer.length,
      });
    }
    flushSentenceBoundaries(s, sessionId);
  }

  async function flush(sessionId: string): Promise<void> {
    const s = sessions.get(sessionId);
    if (!s) {
      if (debug.enabled) {
        debug.log('voice.pwa.tts-bridge', 'flush.unknown', { sessionId });
      }
      return;
    }
    // Commit any tail text as the final sentence.
    const remainder = s.buffer.trim();
    s.buffer = '';
    if (remainder) {
      enqueueSentence(s, sessionId, remainder);
    } else if (debug.enabled) {
      debug.log('voice.pwa.tts-bridge', 'flush.empty-tail', { sessionId });
    }
    // Wait for all queued synths to complete so the daemon-direct
    // loop returns only after the user has heard the full response.
    await s.queueTail;
    if (debug.enabled) {
      debug.log('voice.pwa.tts-bridge', 'flush.drained', { sessionId });
    }
  }

  function attach(sessionId: string, emit: PwaTtsBridgeEmit): void {
    const s = getOrCreate(sessionId);
    s.emit = emit;
    if (debug.enabled) {
      debug.log('voice.pwa.tts-bridge', 'attach', { sessionId });
    }
  }

  function detach(sessionId: string): void {
    const s = sessions.get(sessionId);
    if (!s) return;
    s.detached = true;
    sessions.delete(sessionId);
    if (debug.enabled) {
      debug.log('voice.pwa.tts-bridge', 'detach', {
        sessionId,
        droppedChars: s.buffer.length,
      });
    }
  }

  function __peekBuffer(sessionId: string): string {
    return sessions.get(sessionId)?.buffer ?? '';
  }

  return { pushChunk, flush, attach, detach, __peekBuffer };
}
