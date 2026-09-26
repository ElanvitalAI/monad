// Sprint 22 follow-up (2026-04-30) — daemon-wide input-host
// reference shared by PWA / Telegram / Discord `tui-bridge` style
// dispatch modes.
//
// The daemon and dashboard can run in the same process
// (`elanous start --http-port ...`). In that shape, external surfaces
// can route final text into the focused dashboard input instead of
// running an LLM turn directly. This singleton is the narrow seam:
// callers only see `dictateTranscript(text)`.

import { debug } from '../debug/log.js';

export interface DaemonInputHostHandle {
  /** Inject text into the dashboard's focused input as if the user
   *  typed it. Returns false when no dashboard input target is ready. */
  dictateTranscript(text: string): boolean | Promise<boolean>;
}

let cached: DaemonInputHostHandle | null = null;

export function setDaemonInputHost(
  h: DaemonInputHostHandle | null,
): void {
  cached = h;
  if (debug.enabled) {
    debug.log('voice.input-host.singleton', h ? 'set' : 'cleared', {});
  }
}

export function getDaemonInputHost(): DaemonInputHostHandle | null {
  return cached;
}

export function setDaemonInputHostForTesting(
  h: DaemonInputHostHandle | null,
): () => void {
  const prev = cached;
  cached = h;
  return () => { cached = prev; };
}
