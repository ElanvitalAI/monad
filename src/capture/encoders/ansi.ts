// ── Capture Phase 0 — ANSI passthrough encoder ──
//
// Returns the input verbatim. Exists as its own file so the encoder
// lookup table (engine.ts) can keep a uniform `{ format → fn }` shape,
// and so a future iteration can inject normalization (e.g. ensure
// trailing SGR reset) without touching callers.

export function encodeAnsi(input: string): string {
  return input;
}
