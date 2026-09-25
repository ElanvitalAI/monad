// Input-core tunable settings — R6.
//
// User-config ~/.monad/input-bindings.json may carry a `settings`
// object with scalar knobs. Today only `chordWindowMs` is honored;
// future knobs (e.g. repeat delay, modifier remap) land here.
//
// Values are module-local singletons; getInputSettings() reads
// fresh for each call so a reload observes the update without any
// cache-invalidation dance.

export interface InputSettings {
  /** How long (ms) a chord leader stays armed before auto-disarming.
   *  Default 700 ms matches claude-code-fork's CHORD_TIMEOUT_MS and
   *  the tmux default escape-time range. Acceptable range [50, 5000]. */
  chordWindowMs: number;
}

const DEFAULT_SETTINGS: InputSettings = {
  chordWindowMs: 700,
};

const MIN_CHORD_WINDOW_MS = 50;
const MAX_CHORD_WINDOW_MS = 5000;

let current: InputSettings = { ...DEFAULT_SETTINGS };

export function getInputSettings(): Readonly<InputSettings> {
  return current;
}

/** Apply a partial settings patch. Unknown fields are ignored; known
 *  fields are range-clamped with a diagnostic returned per rejection
 *  so the loader can surface the problem to the user. */
export interface SettingsApplyResult {
  applied: Partial<InputSettings>;
  rejected: Array<{ field: string; value: unknown; reason: string }>;
}

export function applyInputSettings(patch: Record<string, unknown>): SettingsApplyResult {
  const applied: Partial<InputSettings> = {};
  const rejected: SettingsApplyResult['rejected'] = [];

  if ('chordWindowMs' in patch) {
    const v = patch.chordWindowMs;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      rejected.push({ field: 'chordWindowMs', value: v, reason: 'must be a finite number' });
    } else if (v < MIN_CHORD_WINDOW_MS || v > MAX_CHORD_WINDOW_MS) {
      rejected.push({
        field: 'chordWindowMs', value: v,
        reason: `out of range [${MIN_CHORD_WINDOW_MS}, ${MAX_CHORD_WINDOW_MS}]`,
      });
    } else {
      current.chordWindowMs = v;
      applied.chordWindowMs = v;
    }
  }

  return { applied, rejected };
}

/** Reset to defaults — used when user-config is removed / cleared. */
export function resetInputSettings(): void {
  current = { ...DEFAULT_SETTINGS };
}

/** Test helper. */
export function __resetInputSettingsForTests(): void {
  resetInputSettings();
}
