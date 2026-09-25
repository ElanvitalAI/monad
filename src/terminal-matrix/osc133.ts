// ── OSC 133 sentinel detector (NT-A3) ──
//
// ShellRunner boundary strategy #2 (exit-code / OSC-133 / quiet-idle
// / timeout). Watches the raw PTY byte stream for the shell-prompt
// sentinel bytes and emits BoundaryEvent entries when it sees one.
//
// The sequence format, per "Semantic prompts" (iTerm2, WezTerm,
// contour, final-term, etc.):
//
//   ESC ]  1 3 3  ;  <kind> [ ; <payload> ]  <terminator>
//          ^^^^^        ^^^^^^    ^^^^^^^^^
//          fixed        A/B/C/D   shell-dependent
//
// <terminator> is either BEL (0x07) or ST (ESC \, 0x1B 0x5C).
//
// Kinds we care about:
//   A — prompt start        → { kind: 'prompt-start' }
//   B — prompt end / cmd end → { kind: 'cmd-end', exitCode? }
//   C — command start        → ignored for now (fires when user hits
//                              enter; not useful for the "command
//                              finished" boundary we're after)
//   D — cmd end (alternate used by some shells)
//        → { kind: 'cmd-end', exitCode? }
//
// Design notes
// ────────────
// Byte chunks arriving from `fs.read()` are sized by the kernel, not
// by shell output boundaries, so a sentinel can split across reads.
// The detector keeps a pending buffer across `consume()` calls and
// only commits an event once it has seen a terminator. The pending
// buffer is capped — if a terminator never arrives we drop the oldest
// half rather than grow unbounded.
//
// We intentionally do NOT decide 'quiet-idle' or 'exit' here. Those
// live with the engine that owns the process handle; this detector
// just reports what the stream claims.

import type { BoundaryEvent } from '../shell-runner/types.js';

/** Hard cap on the pending buffer. One real OSC 133 sequence is at
 *  most a few dozen bytes, so 1 KiB leaves generous slack for any
 *  shell that stuffs extras into the payload. Beyond the cap the
 *  oldest half is dropped — a malformed / partial sentinel can't
 *  starve the detector forever. */
const MAX_PENDING_BYTES = 1024;

/** Matches a complete OSC 133 sequence.
 *    group 1 = payload (kind + optional ; + details)
 *    Terminator: BEL (`\x07`) or ST (`\x1b\\`).
 *  [^\x07\x1b]* prevents the payload from swallowing a terminator
 *  or the opening ESC of a later sequence. */
const OSC_133_RX = /\x1b\]133;([^\x07\x1b]*)(?:\x07|\x1b\\)/;

export interface Osc133Detector {
  /** Feed a new chunk of raw PTY bytes. Returns any BoundaryEvent
   *  finalized by this chunk (there can be 0, 1, or many). */
  consume(chunk: string): BoundaryEvent[];
  /** Drop any partial state. Call on PTY respawn or placement
   *  transitions that invalidate the stream. */
  reset(): void;
  /** Expose for tests / debugging — the bytes we're still waiting
   *  on a terminator for. Never emit this to the LLM. */
  readonly pendingLength: number;
}

/** Create a new detector. `now` override lets tests inject a clock
 *  without having to mock Date. */
export function createOsc133Detector(
  now: () => number = Date.now,
): Osc133Detector {
  let pending = '';

  const consume = (chunk: string): BoundaryEvent[] => {
    if (chunk.length === 0) return [];
    pending += chunk;
    const out: BoundaryEvent[] = [];

    // Drain all complete sequences. Each iteration shrinks `pending`
    // by consuming up to (and including) the terminator of the first
    // match. Anything before the match is discarded — text outside
    // OSC 133 sequences is not our concern (the emulator renders it).
    while (true) {
      const m = OSC_133_RX.exec(pending);
      if (!m) break;
      const [full, payload] = m;
      const end = (m.index ?? 0) + full.length;
      const ev = interpretPayload(payload ?? '', now());
      if (ev) out.push(ev);
      pending = pending.slice(end);
    }

    // Cap pending. Keep the tail since a partial sentinel is always
    // at the end — trimming the head is safe.
    if (pending.length > MAX_PENDING_BYTES) {
      pending = pending.slice(pending.length - Math.floor(MAX_PENDING_BYTES / 2));
    }
    return out;
  };

  const reset = () => { pending = ''; };

  return {
    consume,
    reset,
    get pendingLength() { return pending.length; },
  };
}

/** Turn an OSC 133 payload string into a BoundaryEvent, or null when
 *  it is a kind we intentionally swallow (e.g. `C` command-start).
 *  Exported so tests can exercise payload parsing directly. */
export function interpretPayload(
  payload: string,
  at: number,
): BoundaryEvent | null {
  // Kind is the first byte. Optional `;<details>` follows.
  const semi = payload.indexOf(';');
  const kind = semi < 0 ? payload : payload.slice(0, semi);
  const rest = semi < 0 ? '' : payload.slice(semi + 1);

  switch (kind) {
    case 'A':
      return { kind: 'prompt-start', source: 'osc-133', at };
    case 'B':
    case 'D': {
      const exitCode = parseExitCode(rest);
      const ev: BoundaryEvent = { kind: 'cmd-end', source: 'osc-133', at };
      if (exitCode !== undefined) ev.exitCode = exitCode;
      return ev;
    }
    case 'C':
    default:
      return null;
  }
}

/** Pull the exit code out of the `B`/`D` details field. Some shells
 *  send a single integer ("42"); others prepend metadata (e.g.
 *  "aid=abc;42"). We take the LAST token separated by ';' that
 *  parses as a non-negative integer. Returns undefined when no
 *  token fits. */
function parseExitCode(details: string): number | undefined {
  if (details === '') return undefined;
  const tokens = details.split(';');
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i]?.trim() ?? '';
    if (t === '') continue;
    if (!/^\d+$/.test(t)) continue;
    const n = Number(t);
    if (Number.isFinite(n) && n >= 0 && n <= 255) return n;
  }
  return undefined;
}
