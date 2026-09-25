// PR-S1V.5 (sprint 21-Parallel-Voice · 2026-04-29) — Voice REST handlers.
//
// HTTP endpoints exposed by the daemon for the PWA voice client (β-2,
// future PR) and for tooling that wants to drive STT from outside the
// dashboard process. Hosted by `src/boot/daemon-public-server.ts` —
// this file owns the request/response shape and delegates STT to the
// existing `STTProvider` interface so the same providers serve both
// surfaces.
//
//   POST /v1/voice/transcribe   ← PWA records audio · daemon proxies STT
//   GET  /v1/voice/cost         ← PWA status pill polls monthly total
//
// Auth is gated by the daemon-public-server's existing token check;
// this handler trusts the caller has already passed that gate.
//
// Reference: PLAN-pr-s1v5-pwa-voice-wiring-2026-04-29.md §4.1.3 + §4.3.

import { debug } from '../debug/log.js';
import {
  createSTTProvider,
  type STTProvider,
  type STTProviderConfig,
} from './stt-provider.js';
import {
  globalVoiceCostTracker,
  type VoiceCostTracker,
} from './cost-tracker.js';
import { isVoiceCostId } from '../models/voice-costs.js';

const MAX_AUDIO_BYTES = 10 * 1024 * 1024; // 10 MB cap
// PCM byte rate fallback — 16 kHz · 16-bit · mono = 32 bytes/ms. Same
// constant as voice-input-bridge.ts.
const PCM_BYTES_PER_MS = 32;

// ── Handler dependencies ───────────────────────────────────────────

export interface VoiceRestHandlerDeps {
  /** STTProvider used for `/v1/voice/transcribe`. Initialized by the
   *  daemon boot once per process so the API key + provider config are
   *  set in one place. When the provider is null the handler returns
   *  503 (service unavailable) — typically because OPENAI_API_KEY isn't
   *  set. */
  getSttProvider: () => STTProvider | null;
  /** Test seam — substitute the global cost tracker. */
  costTracker?: VoiceCostTracker;
}

export interface VoiceRestHandler {
  handleTranscribe(req: Request): Promise<Response>;
  handleCost(): Response;
}

export function createVoiceRestHandler(deps: VoiceRestHandlerDeps): VoiceRestHandler {
  const tracker = deps.costTracker ?? globalVoiceCostTracker();

  async function handleTranscribe(req: Request): Promise<Response> {
    const stt = deps.getSttProvider();
    if (!stt) {
      return jsonError(503, 'stt-unavailable', 'STT provider not configured (set OPENAI_API_KEY and restart daemon)');
    }

    const ct = req.headers.get('content-type') ?? '';
    if (!ct.startsWith('multipart/form-data')) {
      return jsonError(415, 'invalid-content-type', 'expected multipart/form-data');
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch (err) {
      return jsonError(400, 'invalid-multipart', `failed to parse multipart body: ${String(err)}`);
    }

    const audio = form.get('audio');
    if (!(audio instanceof Blob)) {
      return jsonError(400, 'missing-audio', 'audio field must be a file/blob');
    }
    if (audio.size === 0) {
      return jsonError(400, 'empty-audio', 'audio blob is empty');
    }
    if (audio.size > MAX_AUDIO_BYTES) {
      return jsonError(413, 'audio-too-large', `audio exceeds ${MAX_AUDIO_BYTES} byte cap (${audio.size} bytes)`);
    }

    const sessionIdField = form.get('sessionId');
    const sessionId = typeof sessionIdField === 'string' && sessionIdField.length > 0
      ? sessionIdField
      : undefined;
    const langField = form.get('lang');
    const lang = typeof langField === 'string' && langField.length > 0
      ? langField
      : undefined;

    let pcm: Buffer;
    try {
      const ab = await audio.arrayBuffer();
      pcm = Buffer.from(ab);
    } catch (err) {
      return jsonError(400, 'audio-read-failed', `failed to read audio bytes: ${String(err)}`);
    }

    const startedAt = Date.now();
    let result;
    try {
      result = await stt.transcribeBatch(pcm, lang ? { language: lang } : undefined);
    } catch (err) {
      if (debug.enabled)
        debug.log('voice.rest', 'transcribe.error', { err: String(err), bytes: pcm.byteLength }, { level: 'error' });
      return jsonError(502, 'stt-failed', err instanceof Error ? err.message : String(err));
    }
    const latencyMs = Date.now() - startedAt;

    // Record cost. Provider's own durationMs is authoritative; the PCM
    // fallback assumes 16 kHz·16-bit·mono and is only approximate when
    // the upload was webm/opus from MediaRecorder. The status pill
    // accuracy improves once the daemon has verbose_json upgraded
    // Whisper or once duration is reliably echoed back from the
    // provider.
    let costEvent;
    if (isVoiceCostId(stt.id)) {
      const durationMs = result.durationMs ?? Math.round(pcm.byteLength / PCM_BYTES_PER_MS);
      try {
        costEvent = tracker.recordStt({
          providerId: stt.id,
          durationMs,
          ...(sessionId ? { sessionId } : {}),
        });
      } catch (err) {
        if (debug.enabled)
          debug.log('voice.rest', 'cost.record-error', { err: String(err) }, { level: 'error' });
      }
    }

    return jsonOk({
      transcript: result.text,
      ...(result.language ? { language: result.language } : {}),
      ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {}),
      sttProvider: stt.id,
      ...(costEvent ? { costUsd: costEvent.usd } : {}),
      latencyMs,
    });
  }

  function handleCost(): Response {
    const summary = tracker.getMonthSummary();
    return jsonOk({
      monthYYYYMM: summary.monthYYYYMM,
      sttUsd: summary.sttUsd,
      ttsUsd: summary.ttsUsd,
      totalUsd: summary.totalUsd,
      sttDurationSec: summary.sttDurationSec,
      ttsCharCount: summary.ttsCharCount,
    });
  }

  return { handleTranscribe, handleCost };
}

// ── Helpers ────────────────────────────────────────────────────────

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: code, message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// ── STTProvider singleton helper ───────────────────────────────────
//
// Daemon boot calls `initDaemonSttProvider()` once at startup so the
// REST handler doesn't have to instantiate a provider per request.
// Boot decides whether the OPENAI_API_KEY is set — when it isn't, the
// helper stays null and the REST endpoint returns 503.

let _provider: STTProvider | null = null;
let _initPromise: Promise<STTProvider | null> | null = null;

export async function initDaemonSttProvider(
  cfg?: STTProviderConfig,
): Promise<STTProvider | null> {
  if (_provider) return _provider;
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    if (!process.env.OPENAI_API_KEY && (!cfg || cfg.id === 'openai-whisper')) {
      if (debug.enabled)
        debug.log('voice.rest', 'stt.skip-init', { reason: 'no-openai-key' });
      return null;
    }
    try {
      _provider = await createSTTProvider(cfg ?? { id: 'openai-whisper' });
      if (debug.enabled)
        debug.log('voice.rest', 'stt.init-ok', { providerId: _provider.id });
      return _provider;
    } catch (err) {
      if (debug.enabled)
        debug.log('voice.rest', 'stt.init-error', { err: String(err) }, { level: 'error' });
      return null;
    }
  })();
  return _initPromise;
}

export function getDaemonSttProvider(): STTProvider | null {
  return _provider;
}

/** Test seam — replace the daemon STT provider instance directly. */
export function setDaemonSttProviderForTesting(p: STTProvider | null): () => void {
  const prev = _provider;
  const prevInit = _initPromise;
  _provider = p;
  _initPromise = null;
  return () => {
    _provider = prev;
    _initPromise = prevInit;
  };
}
