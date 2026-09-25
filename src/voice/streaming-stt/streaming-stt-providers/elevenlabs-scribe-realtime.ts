// M4c follow-up (2026-07-12) — ElevenLabs Scribe v2 Realtime streaming
// STT provider (대표 요청: openai-realtime 대안).
//
// WebSocket wire (docs scraped 2026-07-12 via omni-crawl —
// elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime
// + guides/how-to/speech-to-text/realtime/client-side-streaming):
//
//   URL   wss://api.elevenlabs.io/v1/speech-to-text/realtime
//         ?model_id=scribe_v2_realtime&audio_format=pcm_16000
//         &commit_strategy=manual[&language_code=<iso>]
//   Auth  `xi-api-key` header (Bun WebSocket supports an options object
//         with headers — this provider runs in the Bun daemon/runner).
//         Browser contexts must use single-use `token` query instead.
//
//   client → server (single message type):
//     { message_type: 'input_audio_chunk',
//       audio_base_64: '<b64 pcm>', commit: bool, sample_rate: 16000 }
//
//   server → client:
//     { message_type: 'session_started', session_id, config }
//     { message_type: 'partial_transcript',  text }
//       ⚠ SNAPSHOT semantics — 실측 2026-07-12 (14.3s 한국어 발화 라이브
//       프로브, partial 14건): 매 partial 은 발화 시작부터의 전체 러닝
//       트랜스크립트이며 앞부분을 소급 수정하기도 한다 ("디스코드" →
//       "Discord"). onPartial 은 pass-through 가 정답 — G-VOX-5 식 델타
//       누적기를 이식하면 오히려 중복 버그가 된다 (openai-realtime 의
//       .delta 와 반대 계약).
//     { message_type: 'committed_transcript', text }   ← final
//     { message_type: 'committed_transcript_with_timestamps', text, words }
//     { message_type: <error-type>, error }  — error/auth_error/
//       quota_exceeded/commit_throttled/rate_limited/… (treat any
//       message carrying an `error` field as onError)
//
// commit_strategy is MANUAL by design: Discord stops shipping packets
// on silence, so server VAD would never see the gap (the same failure
// the openai provider had — see discord-voice-channel-harness.ts
// silence-gap finalize). The harness's client-side silence timer calls
// finalize() → we send an empty chunk with commit:true → server
// replies committed_transcript → onFinal → close. Single-utterance
// session, matching the StreamingSTTSession contract.

import { Buffer } from 'node:buffer';
import { debug } from '../../../debug/log.js';
import { isVoiceCostId, type VoiceCostId } from '../../../models/voice-costs.js';
import { globalVoiceCostTracker } from '../../cost-tracker.js';
import {
  StreamingSTTProviderUnavailableError,
  type ElevenLabsScribeRealtimeConfig,
  type StreamingSTTOpts,
  type StreamingSTTPcmFormat,
  type StreamingSTTProvider,
  type StreamingSTTSession,
} from '../streaming-stt-provider.js';

const REALTIME_URL = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime';
const DEFAULT_MODEL_ID = 'scribe_v2_realtime';
const SAMPLE_RATE = 16_000;
/** `await opened` 무기한 행 방지 — openai-realtime-stt 의 동일 상수 이식
 *  (보이스 품질 갭 #2 · RESEARCH-voice-arc-history-vs-discord §3.2). */
const HANDSHAKE_TIMEOUT_MS = 10_000;

const FORMAT: StreamingSTTPcmFormat = {
  sampleRate: SAMPLE_RATE,
  channels: 1,
  bitsPerSample: 16,
};

/** Bun's WebSocket accepts an options bag (headers) as the second
 *  ctor argument — typed loosely so tests can inject a plain fake. */
type WsCtorLoose = new (url: string, opts?: unknown) => WebSocket;

export class ElevenLabsScribeRealtimeProvider implements StreamingSTTProvider {
  readonly id = 'elevenlabs-scribe-realtime' as const;
  readonly format = FORMAT;

  private readonly apiKey: string;
  private readonly defaultModel: string;
  private readonly WebSocketCtor: WsCtorLoose;

  constructor(cfg: ElevenLabsScribeRealtimeConfig) {
    const apiKey = cfg.apiKey ?? process.env.ELEVENLABS_API_KEY ?? '';
    if (!apiKey) {
      throw new StreamingSTTProviderUnavailableError(
        'elevenlabs-scribe-realtime',
        'ELEVENLABS_API_KEY env or cfg.apiKey required',
      );
    }
    this.apiKey = apiKey;
    this.defaultModel = cfg.model
      ?? process.env.ELEVENLABS_STT_MODEL_ID?.trim()
      ?? DEFAULT_MODEL_ID;
    this.WebSocketCtor = (cfg.WebSocketCtor ?? globalThis.WebSocket) as unknown as WsCtorLoose;
    if (!this.WebSocketCtor) {
      throw new StreamingSTTProviderUnavailableError(
        'elevenlabs-scribe-realtime',
        'WebSocket constructor not available — Bun / Node 22+ required',
      );
    }
  }

  async openSession(opts: StreamingSTTOpts = {}): Promise<StreamingSTTSession> {
    const params = new URLSearchParams({
      model_id: opts.model ?? this.defaultModel,
      audio_format: `pcm_${SAMPLE_RATE}`,
      commit_strategy: 'manual',
    });
    if (opts.language) params.set('language_code', opts.language);
    const url = `${REALTIME_URL}?${params.toString()}`;
    if (debug.enabled)
      debug.log('voice.stt.elevenlabs', 'ws.construct', {
        model: opts.model ?? this.defaultModel,
        language: opts.language ?? null,
        runtime: typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined' ? 'bun' : 'node',
      });
    const ws = new this.WebSocketCtor(url, {
      headers: { 'xi-api-key': this.apiKey },
    });

    let open = false;
    let closed = false;
    let finalizing = false;
    let everOpen = false;
    let openResolve: () => void = () => {};
    let openReject: (e: Error) => void = () => {};
    const opened = new Promise<void>((res, rej) => {
      openResolve = res;
      openReject = rej;
    });

    ws.addEventListener('open', () => {
      open = true;
      everOpen = true;
      openResolve();
      if (debug.enabled) debug.log('voice.stt.elevenlabs', 'ws.open', {});
    });

    ws.addEventListener('close', (ev) => {
      const code = (ev as unknown as { code?: number }).code;
      const reason = (ev as unknown as { reason?: string }).reason;
      const wasOpen = open;
      closed = true;
      open = false;
      if (debug.enabled)
        debug.log('voice.stt.elevenlabs', 'ws.close', {
          code: code ?? null, reason: reason ?? null, wasOpen, finalizing,
        });
      opts.onClose?.();
      if (!everOpen) {
        openReject(new Error(
          `elevenlabs-scribe-realtime WebSocket closed before open${
            code ? ` (code=${code})` : ''}${reason ? `: ${reason}` : ''}`,
        ));
      } else if (wasOpen && !finalizing) {
        opts.onError?.(new Error(
          `elevenlabs-scribe-realtime WebSocket closed unexpectedly${
            code ? ` (code=${code})` : ''}${reason ? `: ${reason}` : ''}`,
        ));
      }
    });

    ws.addEventListener('error', () => {
      // Bun fires a bare event; the close handler carries the detail.
      if (!everOpen) openReject(new Error('elevenlabs-scribe-realtime WebSocket error before open'));
    });

    ws.addEventListener('message', (ev) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String((ev as MessageEvent).data)) as Record<string, unknown>;
      } catch {
        return;
      }
      const type = typeof msg.message_type === 'string' ? msg.message_type : '';
      switch (type) {
        case 'session_started':
          if (debug.enabled)
            debug.log('voice.stt.elevenlabs', 'session.started', { sessionId: msg.session_id });
          return;
        case 'partial_transcript': {
          const text = typeof msg.text === 'string' ? msg.text : '';
          if (text) opts.onPartial?.(text);
          return;
        }
        case 'committed_transcript':
        case 'committed_transcript_with_timestamps': {
          const text = typeof msg.text === 'string' ? msg.text : '';
          if (debug.enabled)
            debug.log('voice.stt.elevenlabs', 'transcript.committed', { chars: text.length });
          if (text) opts.onFinal?.(text);
          // Single-utterance contract — the commit closes the turn.
          if (finalizing) {
            try { ws.close(); } catch { /* already closing */ }
          }
          return;
        }
        default: {
          // Every error variant (error/auth_error/quota_exceeded/
          // commit_throttled/rate_limited/…) carries an `error` field.
          if (typeof msg.error === 'string' && msg.error) {
            if (debug.enabled)
              debug.log('voice.stt.elevenlabs', 'server.error', { type, error: msg.error }, { level: 'error' });
            opts.onError?.(new Error(`elevenlabs-scribe-realtime ${type || 'error'}: ${msg.error}`));
          }
        }
      }
    });

    // Handshake timeout — an unreachable endpoint / stalled TLS leaves
    // `opened` pending forever and the Discord harness would silently
    // swallow every utterance in the meantime.
    let handshakeTimer: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<void>((_, reject) => {
      handshakeTimer = setTimeout(() => {
        if (debug.enabled)
          debug.log('voice.stt.elevenlabs', 'handshake.timeout', { timeoutMs: HANDSHAKE_TIMEOUT_MS }, { level: 'warn' });
        try { ws.close(); } catch { /* swallow */ }
        reject(new Error(
          `elevenlabs-scribe-realtime WebSocket handshake timed out after ${HANDSHAKE_TIMEOUT_MS}ms — check ELEVENLABS_API_KEY + network`,
        ));
      }, HANDSHAKE_TIMEOUT_MS);
    });
    try {
      await Promise.race([opened, timeoutPromise]);
    } finally {
      if (handshakeTimer) clearTimeout(handshakeTimer);
    }

    // 비용 트래킹 (보이스 품질 갭 #1) — openai-realtime-stt 와 같은
    // 자가 기록 패턴. 세션이 어떻게 끝나든(정상 finalize·abort) 밀어
    // 넣은 오디오는 과금되므로 once-guard 로 한 번만 기록한다.
    let approxAudioMs = 0;
    let costRecorded = false;
    const recordUsage = (): void => {
      if (costRecorded || approxAudioMs <= 0) return;
      costRecorded = true;
      const costId = 'elevenlabs-scribe';
      if (!isVoiceCostId(costId)) return;
      try {
        globalVoiceCostTracker().recordStt({ providerId: costId as VoiceCostId, durationMs: approxAudioMs });
      } catch (err) {
        if (debug.enabled)
          debug.log('voice.stt.elevenlabs', 'cost.error', { err: String(err) }, { level: 'error' });
      }
    };

    const sendChunk = (pcm: Buffer, commit: boolean): void => {
      if (closed || ws.readyState !== 1) return;
      try {
        ws.send(JSON.stringify({
          message_type: 'input_audio_chunk',
          audio_base_64: pcm.length > 0 ? pcm.toString('base64') : '',
          commit,
          sample_rate: SAMPLE_RATE,
        }));
        // PCM 16 kHz · 16-bit · 1 ch = 32 bytes/ms.
        approxAudioMs += pcm.length / 32;
      } catch (err) {
        if (debug.enabled)
          debug.log('voice.stt.elevenlabs', 'send.error', { err: String(err) }, { level: 'error' });
      }
    };

    return {
      pushAudio: (pcm: Buffer) => { sendChunk(pcm, false); },
      finalize: async () => {
        if (closed) { recordUsage(); return; }
        finalizing = true;
        // Empty chunk with commit:true — flushes the segment; server
        // replies committed_transcript and we close on receipt. Safety
        // net: force-close after 5 s if the commit reply never lands.
        sendChunk(Buffer.alloc(0), true);
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            try { ws.close(); } catch { /* noop */ }
            resolve();
          }, 5_000);
          ws.addEventListener('close', () => {
            clearTimeout(timer);
            resolve();
          });
        });
        recordUsage();
      },
      abort: async () => {
        finalizing = true; // suppress the unexpected-close onError path
        try { ws.close(); } catch { /* noop */ }
        recordUsage();
      },
      isOpen: () => !closed && ws.readyState === 1,
    };
  }
}
