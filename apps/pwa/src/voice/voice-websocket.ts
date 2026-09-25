// WebSocket transport for voice channel. Encodes upstream PCM/JSON frames
// per the PWA_VOICE_FRAME_KIND protocol and decodes downstream PCM/JSON
// frames into typed callbacks.

import {
  PWA_VOICE_FRAME_KIND,
  decodeFrame,
  decodeJsonPayload,
  encodeFrame,
  encodeJsonPayload,
  type DownstreamTranscript,
} from './voice-frame-protocol';
import { debugLog } from '@/lib/debug';

export type VoiceSocketState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'closing'
  | 'closed'
  | 'error';

export interface VoiceSocketOpts {
  /** WebSocket URL — typically `wss://<daemon-host>/v1/voice/ws`. */
  url: string;
  /** Bearer token sent in the UPSTREAM_HELLO frame for auth. */
  token?: string;
  /** Optional JSON capabilities/metadata to ship in the hello frame. */
  hello?: Record<string, unknown>;
  /** Server → browser PCM frame (int16 LE 24kHz mono). */
  onDownstreamPcm: (pcm: Uint8Array) => void;
  /** Server → browser state transition. */
  onState?: (state: string) => void;
  /** Server → browser live transcript (partial / final / assistant). */
  onTranscript?: (evt: DownstreamTranscript) => void;
  /** Server → browser error. */
  onError?: (err: { error: string }) => void;
  /** Local WebSocket lifecycle. */
  onSocketState?: (state: VoiceSocketState) => void;
}

export interface VoiceSocketHandle {
  sendUpstreamPcm(pcm: Uint8Array): void;
  finalize(): void;
  /** BI-1 manual barge-in (Phase D · 2026-05-09) — fire
   *  UPSTREAM_INTERRUPT to the daemon. */
  sendInterrupt(): void;
  close(): void;
  getState(): VoiceSocketState;
}

export function createVoiceSocket(opts: VoiceSocketOpts): VoiceSocketHandle {
  let state: VoiceSocketState = 'connecting';
  const setState = (s: VoiceSocketState): void => {
    state = s;
    opts.onSocketState?.(s);
    debugLog('voice.ws.state', { state: s, url: opts.url });
  };

  debugLog('voice.ws.construct', {
    url: opts.url,
    hasToken: !!opts.token,
    location: typeof window !== 'undefined' ? window.location.href : '(no window)',
    pageProto: typeof window !== 'undefined' ? window.location.protocol : '(no window)',
    wsProto: opts.url.startsWith('wss:') ? 'wss' : opts.url.startsWith('ws:') ? 'ws' : '(other)',
  });

  let ws: WebSocket;
  try {
    ws = new WebSocket(opts.url);
    ws.binaryType = 'arraybuffer';
    debugLog('voice.ws.constructed', { readyState: ws.readyState, url: ws.url });
  } catch (err) {
    setState('error');
    const msg = err instanceof Error ? err.message : String(err);
    debugLog('voice.ws.construct-throw', { msg, url: opts.url });
    opts.onError?.({ error: `ws construct failed: ${msg}` });
    return {
      sendUpstreamPcm() { /* no-op */ },
      finalize() { /* no-op */ },
      sendInterrupt() { /* no-op */ },
      close() { /* no-op */ },
      getState: () => state,
    };
  }

  ws.onopen = () => {
    debugLog('voice.ws.open', {
      readyState: ws.readyState,
      url: ws.url,
      protocol: ws.protocol,
      extensions: ws.extensions,
    });
    setState('open');
    const hello = { ...(opts.hello ?? {}), ...(opts.token ? { token: opts.token } : {}) };
    const payload = encodeJsonPayload(hello);
    ws.send(encodeFrame(PWA_VOICE_FRAME_KIND.UPSTREAM_HELLO, payload));
    debugLog('voice.ws.hello-sent', { helloKeys: Object.keys(hello) });
  };

  ws.onmessage = (ev: MessageEvent<ArrayBuffer | string>) => {
    if (typeof ev.data === 'string') {
      // Server text fallback — surface as error so we don't silently drop.
      opts.onError?.({ error: `unexpected text frame: ${ev.data.slice(0, 200)}` });
      return;
    }
    try {
      const frame = decodeFrame(ev.data);
      switch (frame.kind) {
        case PWA_VOICE_FRAME_KIND.DOWNSTREAM_PCM:
          opts.onDownstreamPcm(frame.payload);
          break;
        case PWA_VOICE_FRAME_KIND.DOWNSTREAM_STATE: {
          const { state: s } = decodeJsonPayload<{ state: string }>(frame.payload);
          opts.onState?.(s);
          break;
        }
        case PWA_VOICE_FRAME_KIND.DOWNSTREAM_ERROR: {
          const e = decodeJsonPayload<{ error: string }>(frame.payload);
          opts.onError?.(e);
          break;
        }
        case PWA_VOICE_FRAME_KIND.DOWNSTREAM_TRANSCRIPT: {
          const evt = decodeJsonPayload<DownstreamTranscript>(frame.payload);
          opts.onTranscript?.(evt);
          break;
        }
        default:
          // Forward unknown kinds as errors so protocol drift is visible.
          opts.onError?.({ error: `unknown frame kind 0x${frame.kind.toString(16)}` });
      }
    } catch (err) {
      opts.onError?.({ error: err instanceof Error ? err.message : String(err) });
    }
  };

  ws.onclose = (ev: CloseEvent) => {
    debugLog('voice.ws.close', {
      code: ev.code,
      reason: ev.reason,
      wasClean: ev.wasClean,
      readyState: ws.readyState,
      priorState: state,
    });
    setState('closed');
  };
  ws.onerror = (ev: Event) => {
    // Browsers expose almost nothing on the WebSocket error event by
    // design (cross-origin info-disclosure prevention). Capture every
    // hint we have so the close event that usually follows can be
    // correlated against transport state.
    const detail = {
      readyState: ws.readyState,
      url: ws.url,
      eventType: ev.type,
      isTrusted: (ev as Event & { isTrusted?: boolean }).isTrusted,
    };
    debugLog('voice.ws.error', detail);
    setState('error');
    opts.onError?.({
      error: `websocket transport error (readyState=${ws.readyState}, url=${ws.url})`,
    });
  };

  function sendUpstreamPcm(pcm: Uint8Array): void {
    if (state !== 'open') return;
    ws.send(encodeFrame(PWA_VOICE_FRAME_KIND.UPSTREAM_PCM, pcm));
  }

  function finalize(): void {
    if (state !== 'open') return;
    ws.send(encodeFrame(PWA_VOICE_FRAME_KIND.UPSTREAM_FINALIZE, new Uint8Array(0)));
  }

  /** BI-1 manual barge-in (Phase D · 2026-05-09) — fire UPSTREAM_INTERRUPT
   *  to the daemon. Server reaction: STT abort + dispatch cancellation.
   *  Local TTS playback cancel is the controller's job (the playback
   *  handle lives there, not in the socket layer). */
  function sendInterrupt(): void {
    if (state !== 'open') return;
    ws.send(encodeFrame(PWA_VOICE_FRAME_KIND.UPSTREAM_INTERRUPT, new Uint8Array(0)));
  }

  function close(): void {
    if (state === 'closed' || state === 'closing') return;
    setState('closing');
    try { ws.close(1000, 'client-close'); } catch { /* ignore */ }
  }

  return { sendUpstreamPcm, finalize, sendInterrupt, close, getState: () => state };
}
