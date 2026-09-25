// Input-core chord state — tmux-style prefix chord for the resolver.
//
// The dashboard-level `src/chord.ts` machine is scoped to pane-browse
// mode and drives a HUD indicator. For INPUT-focus usage (textInput
// buffering plain letters) we need a lightweight, dashboard-free
// chord state so chat.ts can consult it without importing dashboard
// internals.
//
// Phase 5 of ~/.claude/plans/snuggly-floating-dawn.md —
// unblocks the user's original pain point: `Ctrl+B s` from the chat
// input never reached the sync-mode entry because chat.ts:1293
// buffered the `s` before any outer dispatch could see it.

const DEFAULT_CHORD_WINDOW_MS = 700;

interface ChordLeader {
  matcher: string;         // canonical prefix, e.g. 'ctrl+b'
  armedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  onTimeout: (() => void) | null;
}

let active: ChordLeader | null = null;

export function armChordLeader(
  matcher: string,
  onTimeout?: () => void,
  ms: number = DEFAULT_CHORD_WINDOW_MS,
): void {
  if (active && active.timer) clearTimeout(active.timer);
  const leader: ChordLeader = {
    matcher: matcher.toLowerCase(),
    armedAt: Date.now(),
    onTimeout: onTimeout ?? null,
    timer: null,
  };
  leader.timer = setTimeout(() => {
    if (active === leader) {
      active = null;
      leader.onTimeout?.();
    }
  }, ms);
  active = leader;
}

/** Consume a continuation key. Returns the combined matcher
 *  (`"<leader> <continuation>"`, space-separated, lowercased) if a
 *  chord was armed, or null otherwise. Always clears the chord. */
export function consumeChordContinuation(continuationMatcher: string): string | null {
  if (!active) return null;
  if (active.timer) clearTimeout(active.timer);
  const combined = `${active.matcher} ${continuationMatcher.toLowerCase()}`;
  active = null;
  return combined;
}

export function isChordArmed(): boolean {
  return active !== null;
}

/** Cancel the chord immediately (no onTimeout fire). Safe when not
 *  armed. */
export function disarmChordLeader(): void {
  if (active && active.timer) clearTimeout(active.timer);
  active = null;
}

/** Test helper — wipe chord state between scenarios. */
export function __resetChordStateForTests(): void {
  if (active && active.timer) clearTimeout(active.timer);
  active = null;
}
