// PR-S1V.8 (sprint 22 Phase 3 · 2026-04-29) — OpenAI realtime STT.
//
// Opens a WebSocket to `wss://api.openai.com/v1/realtime?intent=transcription`
// with subprotocol-based auth (Bun's standard `WebSocket` constructor
// can't pass `Authorization` headers, but the OpenAI realtime API
// accepts `openai-insecure-api-key.<key>` as a Sec-WebSocket-Protocol
// value — same trick the browser SDK uses for ephemeral tokens).
//
// Wire format:
//   send → `{type: 'input_audio_buffer.append', audio: base64(pcm16)}`
//   send → `{type: 'input_audio_buffer.commit'}` (on finalize)
//   recv ← `{type: '...transcription.delta', delta: '...'}` → onPartial
//   recv ← `{type: '...transcription.completed', transcript: '...'}` → onFinal
//
// Reference: ROADMAP §4.2 · platform.openai.com/docs/api-reference/realtime.

import { debug } from '../../../debug/log.js';
import { isVoiceCostId, type VoiceCostId } from '../../../models/voice-costs.js';
import { globalVoiceCostTracker } from '../../cost-tracker.js';
import {
  DEFAULT_STREAMING_STT_FORMAT,
  StreamingSTTProviderUnavailableError,
  type OpenAIRealtimeSTTConfig,
  type StreamingSTTOpts,
  type StreamingSTTPcmFormat,
  type StreamingSTTProvider,
  type StreamingSTTProviderId,
  type StreamingSTTSession,
} from '../streaming-stt-provider.js';

// 2026-04-30 (experiment/voice-chat-realtime-rebind):
// Spec evolution + final form:
//
//   - Legacy: `?intent=transcription&model=<id>` (4000 invalid_model)
//   - First attempt: bare URL with model in session.update payload
//     (server replied missing_model)
//   - Second attempt: `?model=gpt-4o-mini-transcribe` (server replied
//     `Model "gpt-4o-mini-transcribe" is not supported in realtime
//     mode`)
//
// Final form — TWO separate model identifiers:
//   - URL `?model=<base>` requires a *realtime base model* (the
//     conversation/response engine, e.g. `gpt-realtime` /
//     `gpt-4o-realtime-preview`).
//   - session.update `audio.input.transcription.model` is the
//     *transcription provider* (`whisper-1` / `gpt-4o-mini-transcribe`
//     / `gpt-4o-transcribe` / **`gpt-realtime-whisper`** — 2026-05 GA).
//
// 2026-05-12 update: OpenAI shipped `gpt-realtime-whisper` (May 2026) —
// next-gen streaming STT with tunable latency 0.4–3.0s, domain adaptation
// (short keyword lists), optional logprobs/timestamps, $0.017/audio-min.
// Same WebSocket wire format (session.update payload, 24 kHz mono PCM,
// transcription.delta / transcription.completed events) — opt-in via
// user-config `voice.stt.model` or env `OPENAI_REALTIME_STT_MODEL`.
//
// Reference: developers.openai.com/api/docs/guides/realtime-websocket +
// /realtime-transcription + /models/gpt-realtime-whisper. Scraped
// 2026-04-30 (v1) + 2026-05-12 (gpt-realtime-whisper addendum).
const REALTIME_BASE_URL = 'wss://api.openai.com/v1/realtime';
/** Base realtime model — drives the WebSocket query string. Must be
 *  one of OpenAI's realtime-capable models.
 *
 *  2026-06-02 (G-VOX-1): default `gpt-4o-realtime-preview` → `gpt-realtime`.
 *  사용자 dogfood 가 sk-proj-* (project key 시대 신규 key) 의 realtime
 *  model access 에 `gpt-4o-realtime-preview` 미포함 확인 (OpenAI `/v1/
 *  models` 검증). `gpt-realtime` 가 현재 GA · 모든 tier 보유. 향후 model
 *  rotation 시 user-config `voice.stt.realtimeBaseModel` 또는 legacy env
 *  `OPENAI_REALTIME_BASE_MODEL` 으로 override. */
const DEFAULT_REALTIME_BASE_MODEL = 'gpt-realtime';
/** Transcription model — drives the session.update payload.
 *
 *  Available choices (as of 2026-05-12):
 *    - `gpt-4o-mini-transcribe` — default · $0.003/min · cheap + good
 *    - `gpt-realtime-whisper`   — 2026-05 GA · $0.017/min · best accuracy +
 *                                  tunable latency + domain adaptation
 *    - `whisper-1`              — legacy batch-style fallback
 *    - `gpt-4o-transcribe`      — high quality (non-realtime variant)
 *
 *  Default stays on `gpt-4o-mini-transcribe` for cost safety; users opt
 *  into `gpt-realtime-whisper` via user-config `voice.stt.model` when
 *  accuracy matters more than $/min (e.g. medical/legal dictation, live
 *  captions with jargon). */
const DEFAULT_TRANSCRIPTION_MODEL = 'gpt-4o-mini-transcribe';

export class OpenAIRealtimeSTTProvider implements StreamingSTTProvider {
  readonly id: StreamingSTTProviderId = 'openai-realtime-stt';
  readonly format: StreamingSTTPcmFormat = DEFAULT_STREAMING_STT_FORMAT;

  private readonly apiKey: string;
  private readonly defaultModel: string;
  private readonly defaultRealtimeBaseModel: string;
  private readonly WebSocketCtor: typeof WebSocket;

  constructor(cfg: OpenAIRealtimeSTTConfig) {
    const apiKey = cfg.apiKey ?? process.env.OPENAI_API_KEY ?? '';
    if (!apiKey) {
      throw new StreamingSTTProviderUnavailableError(
        'openai-realtime-stt',
        'OPENAI_API_KEY env or cfg.apiKey required',
      );
    }
    this.apiKey = apiKey;
    // Transcription model — drives session.update payload.
    this.defaultModel = cfg.model
      ?? process.env.OPENAI_REALTIME_STT_MODEL?.trim()
      ?? DEFAULT_TRANSCRIPTION_MODEL;
    // Realtime base model — drives the WebSocket URL query.
    // Precedence (AGENTS.md §user-config-over-env · 2026-06-02 G-VOX-1):
    //   cfg.realtimeBaseModel (user-config voice.stt.realtimeBaseModel)
    //   > process.env.OPENAI_REALTIME_BASE_MODEL (legacy fallback)
    //   > DEFAULT_REALTIME_BASE_MODEL ('gpt-realtime')
    this.defaultRealtimeBaseModel = cfg.realtimeBaseModel?.trim()
      ?? process.env.OPENAI_REALTIME_BASE_MODEL?.trim()
      ?? DEFAULT_REALTIME_BASE_MODEL;
    this.WebSocketCtor = cfg.WebSocketCtor ?? globalThis.WebSocket;
    if (!this.WebSocketCtor) {
      throw new StreamingSTTProviderUnavailableError(
        'openai-realtime-stt',
        'WebSocket constructor not available — Bun / Node 22+ required',
      );
    }
  }

  async openSession(opts: StreamingSTTOpts = {}): Promise<StreamingSTTSession> {
    // Two distinct model identifiers — see header comment for why.
    const transcriptionModel = opts.model ?? this.defaultModel;
    const realtimeBaseModel = this.defaultRealtimeBaseModel;
    const url = `${REALTIME_BASE_URL}?model=${encodeURIComponent(realtimeBaseModel)}`;
    // Updated 2026-04-30 (experiment/voice-chat-realtime-rebind):
    // OpenAI realtime spec changed the subprotocol set. The legacy
    // pair `[insecure-api-key.<key>, openai-beta.realtime-v1]` now
    // returns close 1002 "Mismatch client protocol". Current docs
    // (developers.openai.com/api/docs/guides/realtime-websocket) show
    // `["realtime", "openai-insecure-api-key.<key>"]` — `realtime`
    // first, beta header gone. Confirmed via firecrawl scrape of the
    // canonical guide.
    const protocols = [
      'realtime',
      `openai-insecure-api-key.${this.apiKey}`,
    ];
    if (debug.enabled)
      debug.log('voice.stt.openai', 'ws.construct', {
        url: url.replace(/[?&]model=[^&]+/, '&model=...'),
        protocolCount: protocols.length,
        apiKeyLen: this.apiKey.length,
        runtime: typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined' ? 'bun' : 'node',
      });
    const ws = new this.WebSocketCtor(url, protocols);

    let open = false;
    let closed = false;
    let finalizing = false;
    let openResolve: () => void = () => {};
    let openReject: (e: Error) => void = () => {};
    const opened = new Promise<void>((res, rej) => {
      openResolve = res;
      openReject = rej;
    });
    const constructTs = Date.now();
    const closePromise = new Promise<void>((resolve) => {
      ws.addEventListener('close', (ev) => {
        const code = (ev as unknown as { code?: number }).code;
        const reason = (ev as unknown as { reason?: string }).reason;
        const wasOpen = open;
        if (debug.enabled)
          debug.log('voice.stt.openai', 'close', {
            code: code ?? null,
            reason: reason ?? null,
            wasOpen,
            finalizing,
            elapsedMs: Date.now() - constructTs,
          });
        closed = true;
        open = false;
        opts.onClose?.();
        // If the WS closed before `open` ever fired, surface a
        // descriptive error so `await opened` rejects instead of hanging.
        if (!ws_was_open_at_least_once) {
          openReject(new Error(
            `openai-realtime-stt WebSocket closed before open${
              code ? ` (code=${code})` : ''}${reason ? `: ${reason}` : ''}`,
          ));
        } else if (wasOpen && !finalizing) {
          // Mid-listening unexpected close — surface as onError so the
          // pipeline's cleanup runs (cancel + controller.exit). Without
          // this hook the dashboard stays in `listening` phase forever
          // because nothing else flips controller state, leading to a
          // modal-A keyboard deadlock (only Ctrl+Shift+Q escapes).
          opts.onError?.(new Error(
            `openai-realtime-stt WebSocket closed unexpectedly${
              code ? ` (code=${code})` : ''}${reason ? `: ${reason}` : ''}`,
          ));
        }
        resolve();
      });
    });
    let ws_was_open_at_least_once = false;

    let approxAudioMs = 0;
    // 2026-06-02 (G-VOX-5) — per-utterance running snapshot buffer.
    //
    // OpenAI Realtime API의 `conversation.item.input_audio_transcription
    // .delta` 이벤트는 **incremental token chunk** 를 `delta` 필드에 담아
    // 보낸다 (snapshot 아님). 한 번에 한 토큰 또는 한 조각만 도착.
    //
    // 그런데 채널 어댑터 / 클라이언트 (iOS Chat/VoiceRecordingService.swift
    // ` handleTranscript`) 는 partial = "현재 발화의 누적 snapshot" 으로
    // 가정 (overwrite semantics). 두 가정이 어긋나면 입력창에 마지막 델타
    // 한 토큰만 잠깐 보이고 이전 누적분이 모두 사라지는 flicker → 사용자
    // 가 "지속적으로 클리어" 라고 보고 (2026-06-02 dogfood bundle).
    //
    // PR #3127 의 iOS-side 빈 final 가드는 별개의 케이스 (VAD 경계 빈
    // final) 만 막았지 본 누적 미스매치 자체는 그대로. 본 PR (G-VOX-5)
    // 가 wire 정합 수정: provider 가 .delta 를 모아 누적 snapshot 으로
    // 노출.
    //
    // 흐름:
    //   - .delta            → pendingPartial += delta;  onPartial(pendingPartial)
    //   - .completed        → pendingPartial = '';      onFinal(transcript)
    //   - .added (snapshot) → pendingPartial = transcript; onPartial(transcript)
    //   - .done             → pendingPartial = '';      onFinal(transcript)
    //
    // gpt-4o-mini-transcribe (.added/.done 만 emit) · gpt-realtime-whisper
    // (.delta/.completed 만 emit) · 혼합 emit 모델 모두 동일 wire 출력.
    let pendingPartial = '';

    ws.addEventListener('open', () => {
      open = true;
      ws_was_open_at_least_once = true;
      // 2026-04-30: OpenAI realtime API session.update payload v2.
      //   - type: 'session.update' (was 'transcription_session.update')
      //   - session.audio.input.{format,transcription,turn_detection}
      //     (was flat input_audio_format / input_audio_transcription)
      //   - format is now an object {type:"audio/pcm",rate:16000} not "pcm16"
      // Reference: developers.openai.com/api/docs/guides/realtime-transcription
      const transcription: Record<string, unknown> = { model: transcriptionModel };
      if (opts.language) transcription.language = opts.language;
      if (opts.prompt) transcription.prompt = opts.prompt;
      // 2026-04-30 — A-path migration:
      // OpenAI GA realtime API rejects mixing `session.type='transcription'`
      // with `?model=<realtime-base-model>`:
      //   "Passing a transcription session update event to a realtime
      //    session is not allowed."
      // …and rejects `?model=<transcription-only>` with:
      //   "Model X is not supported in realtime mode."
      // The B-path fix is REST `/v1/realtime/client_secrets` to
      // pre-create a transcription session — tracked in the backlog.
      // The A-path used here keeps things simple: connect as a
      // `realtime` session but disable response generation
      // (`turn_detection.create_response: false`) so the server only
      // emits transcription events, never tries to speak back. Net
      // effect = transcription-only behaviour with a single WebSocket.
      const sessionPayload = {
        type: 'realtime',
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: 24000 },
            transcription,
            // server VAD finalizes turns automatically. `create_response:
            // false` is the critical knob — without it, server triggers
            // a chat response (LLM tokens + audio output cost) every
            // time silence is detected.
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 500,
              create_response: false,
            },
          },
        },
      };
      try {
        ws.send(JSON.stringify({
          type: 'session.update',
          session: sessionPayload,
        }));
      } catch (err) {
        if (debug.enabled)
          debug.log('voice.stt.openai', 'session-update.error', { err: String(err) }, { level: 'error' });
      }
      if (debug.enabled)
        debug.log('voice.stt.openai', 'open', {
          realtimeBaseModel,
          transcriptionModel,
          language: opts.language,
        });
      openResolve();
    });

    ws.addEventListener('error', (ev) => {
      const evMsg = (ev as unknown as { message?: string }).message;
      const evType = (ev as unknown as { type?: string }).type;
      const err = new Error(
        `openai-realtime-stt WebSocket error${evMsg ? `: ${evMsg}` : ''}`,
      );
      if (debug.enabled)
        debug.log('voice.stt.openai', 'error', {
          err: err.message,
          evType: evType ?? null,
          elapsedMs: Date.now() - constructTs,
          wasOpen: open,
        }, { level: 'error' });
      opts.onError?.(err);
      if (!open) openReject(err);
    });

    ws.addEventListener('message', (ev) => {
      const data = typeof ev.data === 'string' ? ev.data : null;
      if (!data) return;
      let parsed: {
        type?: string;
        delta?: string;
        transcript?: string;
        error?: { message?: string; code?: string; type?: string };
      };
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }
      if (!parsed.type) return;
      // Server-side error events — both the bare `error` type and any
      // suffix variant (e.g. `session.error`) surface through onError so
      // the pipeline's cleanup path runs (cancel + controller.exit).
      if (parsed.type === 'error' || parsed.type.endsWith('.error')) {
        const msg = parsed.error?.message
          ?? parsed.error?.type
          ?? `STT server error (${parsed.type})`;
        if (debug.enabled)
          debug.log('voice.stt.openai', 'server-error', {
            type: parsed.type,
            error: parsed.error ?? null,
          }, { level: 'error' });
        opts.onError?.(new Error(`openai-realtime-stt: ${msg}`));
        return;
      }
      // Realtime API event names changed across betas — match suffixes.
      if (parsed.type.endsWith('transcription.delta') && typeof parsed.delta === 'string') {
        // G-VOX-5 (2026-06-02): accumulate delta into running snapshot.
        // See `pendingPartial` declaration above for the rationale.
        pendingPartial += parsed.delta;
        opts.onPartial?.(pendingPartial);
      } else if (parsed.type.endsWith('transcription.completed') && typeof parsed.transcript === 'string') {
        pendingPartial = '';
        opts.onFinal?.(parsed.transcript);
      } else if (parsed.type.endsWith('.added') || parsed.type.endsWith('.done')) {
        // 2026-05-14 dogfood — OpenAI GA realtime API embeds the
        // transcribed text inside `conversation.item.added` and
        // `conversation.item.done` events under
        // `item.content[].transcript`. Surface it as `partial` (on
        // .added) / `final` (on .done) so streaming clients see live
        // transcription progress.
        //
        // G-VOX-5 (2026-06-02): `.added` 의 transcript 는 FULL snapshot
        // 이라 pendingPartial 을 그 값으로 overwrite (delta path 와의
        // 혼합 emit 모델에서도 정합 유지). `.done` 은 final 이라 reset.
        const full = parsed as unknown as {
          item?: { content?: Array<{ type?: string; transcript?: string }> };
        };
        const xs = full.item?.content;
        if (Array.isArray(xs)) {
          for (const c of xs) {
            if (typeof c?.transcript === 'string' && c.transcript.length > 0) {
              if (parsed.type.endsWith('.done')) {
                pendingPartial = '';
                opts.onFinal?.(c.transcript);
              } else {
                pendingPartial = c.transcript;
                opts.onPartial?.(c.transcript);
              }
            }
          }
        }
        if (debug.enabled) {
          debug.log('voice.stt.openai', 'item-event', {
            type: parsed.type,
            content: xs ?? null,
          });
        }
      } else if (debug.enabled) {
        debug.log('voice.stt.openai', 'unhandled-event', { type: parsed.type });
      }
    });

    // 10s timeout — never hang the dashboard waiting for the WS to
    // open. If OpenAI realtime is unreachable / API key invalid /
    // protocol mismatch, the rejection lands in the caller's
    // try/catch and surfaces a clear status line instead of a frozen
    // listening phase.
    const HANDSHAKE_TIMEOUT_MS = 10_000;
    let handshakeTimer: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<void>((_, reject) => {
      handshakeTimer = setTimeout(() => {
        if (debug.enabled)
          debug.log('voice.stt.openai', 'handshake.timeout', {
            elapsedMs: Date.now() - constructTs,
            wasOpen: open,
          }, { level: 'warn' });
        try { ws.close(); } catch { /* swallow */ }
        reject(new Error(
          `openai-realtime-stt WebSocket handshake timed out after ${HANDSHAKE_TIMEOUT_MS}ms — check OPENAI_API_KEY + network`,
        ));
      }, HANDSHAKE_TIMEOUT_MS);
    });
    try {
      await Promise.race([opened, timeoutPromise]);
    } finally {
      if (handshakeTimer) clearTimeout(handshakeTimer);
    }
    if (debug.enabled)
      debug.log('voice.stt.openai', 'handshake.ok', {
        elapsedMs: Date.now() - constructTs,
      });

    function pushAudio(pcm: Buffer): void {
      if (!open || closed || finalizing) return;
      try {
        // audio-capture global rate is now 24kHz mono (matches OpenAI
        // realtime's >= 24kHz requirement directly — no inline
        // resample needed).
        const b64 = pcm.toString('base64');
        ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: b64 }));
        // PCM 24 kHz · 16-bit · 1 ch = 48_000 bytes/sec.
        approxAudioMs += (pcm.byteLength * 1000) / (24000 * 2);
      } catch (err) {
        if (debug.enabled)
          debug.log('voice.stt.openai', 'push.error', { err: String(err) }, { level: 'error' });
      }
    }

    async function finalize(): Promise<void> {
      if (closed) return;
      finalizing = true;
      try {
        ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      } catch (err) {
        if (debug.enabled)
          debug.log('voice.stt.openai', 'commit.error', { err: String(err) }, { level: 'error' });
      }
      // Wait briefly for the final transcription event, then close.
      // The server emits `...transcription.completed` then closes; we
      // close after a 5s safety timeout.
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, 5000));
      await Promise.race([closePromise, timeout]);
      try { ws.close(); } catch { /* ignore */ }
      await closePromise;
      // Best-effort cost record (transcription model pricing — base
      // realtime model has its own per-token cost on the response
      // side, but transcription-only sessions don't generate response
      // tokens, so we only attribute the audio-input cost).
      const costId = mapCostId(transcriptionModel);
      if (costId && approxAudioMs > 0) {
        try {
          globalVoiceCostTracker().recordStt({ providerId: costId, durationMs: approxAudioMs });
        } catch (err) {
          if (debug.enabled)
            debug.log('voice.stt.openai', 'cost.error', { err: String(err) }, { level: 'error' });
        }
      }
    }

    async function abort(): Promise<void> {
      if (closed) return;
      // 2026-04-30 — flag this as a graceful caller-initiated close so
      // the close handler doesn't surface the resulting `code=1000` as
      // an "unexpected close" onError. Without this, ESC during a
      // healthy listening session triggers a false-alarm warning popup
      // ("voice-chat: WebSocket closed unexpectedly (code=1000)").
      finalizing = true;
      try { ws.close(); } catch { /* ignore */ }
      await closePromise;
    }

    function isOpen(): boolean { return open && !closed; }

    return { pushAudio, finalize, abort, isOpen };
  }
}

function mapCostId(model: string): VoiceCostId | null {
  // The realtime API's transcription mode is metered like the batch
  // gpt-4o-mini-transcribe. Map to the closest registered cost id.
  if (model.startsWith('gpt-4o-mini-transcribe')) {
    const id = 'gpt-4o-mini-transcribe';
    return isVoiceCostId(id) ? (id as VoiceCostId) : null;
  }
  // Fallback to whisper-1 pricing for unknown models — overestimates
  // but never silent.
  const fallback = 'openai-whisper';
  return isVoiceCostId(fallback) ? (fallback as VoiceCostId) : null;
}
