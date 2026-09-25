// ── tmux-style prefix chord ──
//
// A single reusable "armed / disarmed" state machine for one-shot
// prefix chords (e.g. Ctrl+B followed by Ctrl+W jumps to the working
// browser). The timer lives on the state so callers can tear it down
// cleanly on teardown or when a second key consumes the chord.
//
// Keeping the module free of dashboard dependencies — the caller
// wires the HUD indicator and the post-chord draw() so the chord
// module can live in tests without importing the whole TUI.

export interface ChordState {
  armed: boolean;
  armedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export function createChord(): ChordState {
  return { armed: false, armedAt: 0, timer: null };
}

/** Arm the chord. Any previous pending timer is cancelled first so
 *  double-taps of the prefix just reset the window. `onTimeout` runs
 *  when the window elapses without a second key consuming the
 *  chord — typically used to clear the HUD indicator. */
export function armChord(
  state: ChordState,
  onTimeout: () => void,
  ms: number = 1500,
): void {
  if (state.timer) clearTimeout(state.timer);
  state.armed = true;
  state.armedAt = Date.now();
  state.timer = setTimeout(() => {
    state.armed = false;
    state.timer = null;
    onTimeout();
  }, ms);
}

/** Cancel the chord immediately. Safe to call when not armed. */
export function disarmChord(state: ChordState): void {
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  state.armed = false;
}

export function isChordArmed(state: ChordState): boolean {
  return state.armed;
}
