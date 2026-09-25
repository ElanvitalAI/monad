// PR-S1V.8 (sprint 22 Phase 3 · 2026-04-29) — Gemini Live API STT.
//
// Opens a WebSocket to the Gemini Live BidiGenerateContent endpoint
// with the API key in the URL (Google's auth pattern — no headers
// needed). Sends raw PCM 16 kHz · 16-bit signed mono audio as
// `realtimeInput.audio` blobs and listens for
// `serverContent.inputTranscription` events.
//
// Reference: ROADMAP §4.3 · ai.google.dev/gemini-api/docs/live.

import { debug } from '../../../debug/log.js';
import { isVoiceCostId, type VoiceCostId } from '../../../models/voice-costs.js';
import { globalVoiceCostTracker } from '../../cost-tracker.js';
import {
  StreamingSTTProviderUnavailableError,
  type GeminiLiveSTTConfig,
  type StreamingSTTOpts,
  type StreamingSTTPcmFormat,
  type StreamingSTTProvider,
  type StreamingSTTProviderId,
  type StreamingSTTSession,
} from '../streaming-stt-provider.js';

const BASE_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const DEFAULT_MODEL = 'gemini-2.5-flash-live-preview';
/** `await opened` 무기한 행 방지 — openai-realtime-stt 의 동일 상수 이식
 *  (보이스 품질 갭 #2). setupComplete ack 까지 포함한 시간이다 (gemini 는
 *  ws open 이 아니라 setup ack 가 openResolve 를 부른다). */
const HANDSHAKE_TIMEOUT_MS = 10_000;

export class GeminiLiveSTTProvider implements StreamingSTTProvider {
  readonly id: StreamingSTTProviderId = 'gemini-live-stt';
  /** 선언 포맷 정정 (2026-07-12): pushAudio 의 와이어 라벨이
   *  `audio/pcm;rate=16000` 인데 선언은 24k DEFAULT 라 어긋나 있었다.
   *  호출자(디스코드 하네스 provider-format 적응)가 선언을 보고 리샘플을
   *  결정하므로 실제 와이어 계약(16k)과 일치시킨다. */
  readonly format: StreamingSTTPcmFormat = {
    sampleRate: 16_000,
    channels: 1,
    bitsPerSample: 16,
  };

  private readonly apiKey: string;
  private readonly defaultModel: string;
  private readonly WebSocketCtor: typeof WebSocket;

  constructor(cfg: GeminiLiveSTTConfig) {
    const apiKey = cfg.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? '';
    if (!apiKey) {
      throw new StreamingSTTProviderUnavailableError(
        'gemini-live-stt',
        'GEMINI_API_KEY (or GOOGLE_API_KEY) env / cfg.apiKey required',
      );
    }
    this.apiKey = apiKey;
    this.defaultModel = cfg.model ?? process.env.GEMINI_LIVE_MODEL?.trim() ?? DEFAULT_MODEL;
    this.WebSocketCtor = cfg.WebSocketCtor ?? globalThis.WebSocket;
    if (!this.WebSocketCtor) {
      throw new StreamingSTTProviderUnavailableError(
        'gemini-live-stt',
        'WebSocket constructor not available — Bun / Node 22+ required',
      );
    }
  }

  async openSession(opts: StreamingSTTOpts = {}): Promise<StreamingSTTSession> {
    const model = opts.model ?? this.defaultModel;
    const url = `${BASE_URL}?key=${encodeURIComponent(this.apiKey)}`;
    const ws = new this.WebSocketCtor(url);

    let open = false;
    let closed = false;
    let setupAcked = false;
    let openResolve: () => void = () => {};
    let openReject: (e: Error) => void = () => {};
    const opened = new Promise<void>((res, rej) => {
      openResolve = res;
      openReject = rej;
    });
    const closePromise = new Promise<void>((resolve) => {
      ws.addEventListener('close', () => {
        closed = true;
        open = false;
        opts.onClose?.();
        resolve();
      });
    });

    ws.addEventListener('open', () => {
      open = true;
      const setup = {
        setup: {
          model: `models/${model}`,
          generationConfig: { responseModalities: ['TEXT'] },
          inputAudioTranscription: {},
          ...(opts.language ? { speechConfig: { languageCode: opts.language } } : {}),
        },
      };
      try { ws.send(JSON.stringify(setup)); } catch (err) {
        if (debug.enabled)
          debug.log('voice.stt.gemini', 'setup.error', { err: String(err) }, { level: 'error' });
      }
      if (debug.enabled)
        debug.log('voice.stt.gemini', 'open', { model, language: opts.language });
    });

    ws.addEventListener('error', (ev) => {
      const evMsg = (ev as unknown as { message?: string }).message;
      const err = new Error(
        `gemini-live-stt WebSocket error${evMsg ? `: ${evMsg}` : ''}`,
      );
      if (debug.enabled)
        debug.log('voice.stt.gemini', 'error', { err: err.message }, { level: 'error' });
      opts.onError?.(err);
      if (!open) openReject(err);
    });

    ws.addEventListener('message', (ev) => {
      const data = typeof ev.data === 'string' ? ev.data : null;
      if (!data) return;
      let parsed: {
        setupComplete?: unknown;
        serverContent?: {
          inputTranscription?: { text?: string; finished?: boolean };
        };
      };
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }
      if (parsed.setupComplete && !setupAcked) {
        setupAcked = true;
        openResolve();
        return;
      }
      const tx = parsed.serverContent?.inputTranscription;
      if (tx && typeof tx.text === 'string') {
        if (tx.finished) opts.onFinal?.(tx.text);
        else opts.onPartial?.(tx.text);
      }
    });

    // Handshake timeout — unreachable endpoint / missing setup ack
    // would otherwise hang the caller forever (openai-realtime pattern).
    let handshakeTimer: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<void>((_, reject) => {
      handshakeTimer = setTimeout(() => {
        if (debug.enabled)
          debug.log('voice.stt.gemini', 'handshake.timeout', { timeoutMs: HANDSHAKE_TIMEOUT_MS }, { level: 'warn' });
        try { ws.close(); } catch { /* swallow */ }
        reject(new Error(
          `gemini-live-stt WebSocket handshake timed out after ${HANDSHAKE_TIMEOUT_MS}ms — check GEMINI_API_KEY + network`,
        ));
      }, HANDSHAKE_TIMEOUT_MS);
    });
    try {
      await Promise.race([opened, timeoutPromise]);
    } finally {
      if (handshakeTimer) clearTimeout(handshakeTimer);
    }

    // 비용 트래킹 (보이스 품질 갭 #1) — 밀어 넣은 오디오는 세션 종료
    // 방식과 무관하게 과금되므로 finalize/abort 공용 once-guard 기록.
    let approxAudioMs = 0;
    let costRecorded = false;
    const recordUsage = (): void => {
      if (costRecorded || approxAudioMs <= 0) return;
      costRecorded = true;
      const costId = 'gemini-live-stt';
      if (!isVoiceCostId(costId)) return;
      try {
        globalVoiceCostTracker().recordStt({ providerId: costId as VoiceCostId, durationMs: approxAudioMs });
      } catch (err) {
        if (debug.enabled)
          debug.log('voice.stt.gemini', 'cost.error', { err: String(err) }, { level: 'error' });
      }
    };

    function pushAudio(pcm: Buffer): void {
      if (!open || closed) return;
      try {
        const b64 = pcm.toString('base64');
        ws.send(JSON.stringify({
          realtimeInput: {
            audio: { data: b64, mimeType: 'audio/pcm;rate=16000' },
          },
        }));
        // PCM 16 kHz · 16-bit · 1 ch = 32 bytes/ms.
        approxAudioMs += pcm.length / 32;
      } catch (err) {
        if (debug.enabled)
          debug.log('voice.stt.gemini', 'push.error', { err: String(err) }, { level: 'error' });
      }
    }

    async function finalize(): Promise<void> {
      if (closed) { recordUsage(); return; }
      try {
        // Signal end-of-turn — Gemini Live treats no audio + close as done.
        ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
      } catch (err) {
        if (debug.enabled)
          debug.log('voice.stt.gemini', 'finalize.error', { err: String(err) }, { level: 'error' });
      }
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, 5000));
      await Promise.race([closePromise, timeout]);
      try { ws.close(); } catch { /* ignore */ }
      await closePromise;
      recordUsage();
    }

    async function abort(): Promise<void> {
      if (closed) { recordUsage(); return; }
      try { ws.close(); } catch { /* ignore */ }
      await closePromise;
      recordUsage();
    }

    function isOpen(): boolean { return open && !closed && setupAcked; }

    return { pushAudio, finalize, abort, isOpen };
  }
}
