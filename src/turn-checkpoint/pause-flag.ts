// PLAN §4.1 · Phase 1.1 — `/pause` request flag.
//
// Module-level singleton because the `/pause` slash and the
// `streamLLMWithTools` capture hook live in different files but need
// to coordinate within the same process. Re-arm-after-consume so a
// stray `/pause` doesn't permanently halt subsequent turns.

let pauseRequested = false;

export function requestPause(): void {
  pauseRequested = true;
}

export function isPauseRequested(): boolean {
  return pauseRequested;
}

/** Return the previous flag value and clear it atomically.
 *  Callers MUST consume via this helper rather than reading
 *  `isPauseRequested` then resetting separately, so a concurrent
 *  request doesn't get dropped. */
export function consumePauseRequest(): boolean {
  const was = pauseRequested;
  pauseRequested = false;
  return was;
}

/** Test seam — reset without observing. */
export function resetPauseFlag(): void {
  pauseRequested = false;
}
