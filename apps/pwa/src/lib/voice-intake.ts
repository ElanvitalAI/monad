// CV-3 mobile-readiness #3 · voice intake helpers (Phase 0.5).
//
// Browser-native Web Speech API wrapper for the long-press → STT
// → intake plane flow. The existing daemon-side voice WS
// (`apps/pwa/src/voice/use-voice-controller.ts`) auto-broadcasts
// transcripts to all panels — we want a SEPARATE route that
// records once on hold, finalizes on release, and POSTs the
// transcript text to /v1/intake instead of broadcasting.
//
// Web Speech API was the deliberate choice (per BACKLOG §2.3):
//   • Browser-native — no daemon WS allocation per recording.
//   • iOS Safari + Chrome / Edge support; Firefox falls back to
//     "API unavailable" path (UI shows error · ask user to
//     dictate via system keyboard).
//   • Final transcripts only (no streaming) since the intake
//     plane is text-driven.
//
// BACKLOG: 내부 문서 `BACKLOG-pwa-mobile-readiness-2026-05-08` §2.3

interface BrowserSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  length: number;
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEvent {
  error: string;
  message: string;
}

interface SpeechRecognitionConstructor {
  new(): BrowserSpeechRecognition;
}

/** Resolve the browser's SpeechRecognition constructor. Returns null
 *  when the API is unavailable (Firefox · headless contexts). The
 *  Showroom Voice button uses this to gate the long-press flow. */
export function resolveSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof globalThis === 'undefined') return null;
  const w = globalThis as { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface VoiceRecognitionSession {
  /** Currently captured transcript (final + interim segments
   *  joined). Updated as `onResult` fires. */
  readonly transcript: string;
  /** True until stop() resolves. */
  readonly active: boolean;
  /** Stop the session + resolve with the final transcript. The
   *  promise resolves whenever the next `onend` fires (typically
   *  100-500 ms after stop()). Calling stop() multiple times is
   *  idempotent. */
  stop(): Promise<string>;
  /** Hard abort. Resolves with whatever transcript was captured
   *  so far, with `aborted: true`. */
  abort(): Promise<string>;
}

export interface StartRecognitionOpts {
  /** BCP-47 language tag. Default 'ko-KR'. */
  lang?: string;
  /** Optional listener for incremental updates (interim + final).
   *  Use this to drive a live "녹음 중" UI showing current text. */
  onUpdate?: (transcript: string) => void;
  /** Optional fired when the underlying recognition errors out
   *  (network · no-speech · not-allowed · etc.). */
  onError?: (err: { code: string; message: string }) => void;
  /** Test seam — pass a fake constructor that mimics the shape of
   *  `SpeechRecognition`. Production passes nothing. */
  recognitionImpl?: SpeechRecognitionConstructor;
}

/** Start a browser STT session. Returns null when the Web Speech
 *  API is unavailable. The returned handle exposes a Promise-based
 *  stop()/abort() pair so the caller can await the final
 *  transcript.
 *
 *  Implementation detail: we call `recognition.start()` synchronously
 *  inside this function so the user gesture (long-press
 *  pointerdown) propagates into the browser permission prompt
 *  without interruption. iOS Safari is strict about this — calling
 *  start() in an async tick causes a silent permission denial. */
export function startVoiceRecognition(opts: StartRecognitionOpts = {}): VoiceRecognitionSession | null {
  const Ctor = opts.recognitionImpl ?? resolveSpeechRecognition();
  if (!Ctor) return null;

  const recog = new Ctor();
  recog.lang = opts.lang ?? 'ko-KR';
  recog.interimResults = true;
  recog.continuous = true;

  let transcript = '';
  let active = true;
  let endResolve: ((text: string) => void) | null = null;
  const endPromise = new Promise<string>((resolve) => { endResolve = resolve; });

  recog.onresult = (ev: SpeechRecognitionEvent): void => {
    let combined = '';
    for (let i = 0; i < ev.results.length; i += 1) {
      const r = ev.results[i];
      if (!r) continue;
      const alt = r[0];
      if (alt) combined += alt.transcript;
    }
    transcript = combined;
    opts.onUpdate?.(combined);
  };
  recog.onerror = (ev: SpeechRecognitionErrorEvent): void => {
    opts.onError?.({ code: ev.error, message: ev.message });
  };
  recog.onend = (): void => {
    active = false;
    if (endResolve) {
      endResolve(transcript);
      endResolve = null;
    }
  };

  try { recog.start(); }
  catch (e) {
    opts.onError?.({ code: 'start-failed', message: String(e) });
    return null;
  }

  return {
    get transcript() { return transcript; },
    get active() { return active; },
    async stop() {
      try { recog.stop(); } catch { /* ignore */ }
      return endPromise;
    },
    async abort() {
      try { recog.abort(); } catch { /* ignore */ }
      return endPromise;
    },
  };
}

// ─── intake POST ──────────────────────────────────────────────────

export interface VoiceIntakePostOpts {
  baseUrl: string;
  token?: string;
  /** Final transcript string the user dictated. Required (the
   *  intake plane needs `text`). */
  transcript: string;
  /** Optional explicit intakeId. Production normally lets the
   *  server mint one (timestamp-based). */
  intakeId?: string;
  /** Optional fetch impl for tests. */
  fetchImpl?: typeof fetch;
}

export type VoiceIntakeResult =
  | { ok: true; intakeId: string }
  | { ok: false; status: number; reason: string };

/** Compose the intake POST body for a voice transcript. Pure —
 *  exposed for unit tests. */
export function buildIntakeBodyForVoice(opts: {
  transcript: string;
  intakeId?: string;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    text: opts.transcript.trim(),
    actor: 'pwa-voice',
    channelContext: { kind: 'pwa-voice' },
  };
  if (opts.intakeId) body.intakeId = opts.intakeId;
  return body;
}

/** POST a voice transcript to /v1/intake. Returns the resulting
 *  intakeId on success or a typed error otherwise. */
export async function postVoiceIntake(opts: VoiceIntakePostOpts): Promise<VoiceIntakeResult> {
  const text = opts.transcript.trim();
  if (!text) return { ok: false, status: 0, reason: 'empty transcript' };
  const baseUrl = opts.baseUrl.replace(/\/$/, '');
  if (!baseUrl) return { ok: false, status: 0, reason: 'baseUrl not configured' };
  const fetchImpl = opts.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null as unknown as typeof fetch);
  if (!fetchImpl) return { ok: false, status: 0, reason: 'fetch unavailable' };

  try {
    const res = await fetchImpl(`${baseUrl}/v1/intake`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: JSON.stringify(buildIntakeBodyForVoice({
        transcript: text,
        ...(opts.intakeId ? { intakeId: opts.intakeId } : {}),
      })),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, status: res.status, reason: detail || `HTTP ${res.status}` };
    }
    const json = await res.json().catch(() => ({})) as { intakeId?: string };
    return { ok: true, intakeId: json.intakeId ?? '' };
  } catch (e) {
    return { ok: false, status: 0, reason: String(e instanceof Error ? e.message : e) };
  }
}
