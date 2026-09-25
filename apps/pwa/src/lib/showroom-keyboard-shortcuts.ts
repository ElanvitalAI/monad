// FU.B1 (2026-05-09 night) — Showroom keyboard shortcut catalog.
// FU.B3 (2026-05-09 night) — `?` opens the help overlay listing this
// catalog, so dogfood users can discover shortcuts without leaving
// the page.
//
// Pure matcher so the dispatch logic in ShowroomLayout stays simple
// (one `switch` over the matcher's return value) and the table of
// shortcut → effect is unit-testable without a React renderer.

export type ShowroomShortcut =
  /** Focus the broadcast input textarea. ⌘K (Mac) · Ctrl+K (other). */
  | 'focus-broadcast-input'
  /** Toggle the role-judge backend (keyword ↔ local-llm). ⌘⇧J. */
  | 'toggle-role-judge'
  /** Toggle voice mode (mic). ⌘⇧M. */
  | 'toggle-voice'
  /** Toggle TTS mute. ⌘⇧Y. */
  | 'toggle-tts'
  /** Open the keyboard shortcut help overlay. `?` (Shift+/) — no
   *  Cmd/Ctrl modifier so the binding stays single-finger. */
  | 'open-help';

export interface KeyEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** When the event originates from inside an editable surface (text
   *  input, textarea, contenteditable), most shortcuts should be
   *  suppressed so typing isn't intercepted. The exception is
   *  `focus-broadcast-input` — caller may want ⌘K to focus the input
   *  even from another input field. */
  fromEditable?: boolean;
}

/** Cmd-or-Ctrl modifier — Mac uses ⌘ (metaKey) while Win/Linux use
 *  Ctrl. Standard pattern: accept either so the same binding works
 *  cross-platform. */
function isCmdOrCtrl(e: KeyEventLike): boolean {
  return e.metaKey || e.ctrlKey;
}

/** Match an event against the Showroom shortcut catalog. Returns the
 *  matched shortcut id, or null when no shortcut applies (caller
 *  passes the event through to default handling). */
export function isShowroomShortcut(e: KeyEventLike): ShowroomShortcut | null {
  // Normalize alphabetic keys — KeyboardEvent.key is lowercase when
  // shift is up, uppercase when shift is down. Compare against
  // lowercase so 'k' and 'K' both work.
  const k = e.key.toLowerCase();

  // ⌘K / Ctrl+K — focus broadcast input. No shift required.
  if (isCmdOrCtrl(e) && !e.shiftKey && !e.altKey && k === 'k') {
    return 'focus-broadcast-input';
  }

  // ⌘⇧J — toggle role-judge backend.
  if (isCmdOrCtrl(e) && e.shiftKey && !e.altKey && k === 'j') {
    if (e.fromEditable) return null; // typing in input — leave alone
    return 'toggle-role-judge';
  }

  // ⌘⇧M — toggle voice mode (mic). Note: ⌘M alone is "minimize" on
  // Mac browsers, hence the shift requirement.
  if (isCmdOrCtrl(e) && e.shiftKey && !e.altKey && k === 'm') {
    if (e.fromEditable) return null;
    return 'toggle-voice';
  }

  // ⌘⇧Y — toggle TTS mute.
  if (isCmdOrCtrl(e) && e.shiftKey && !e.altKey && k === 'y') {
    if (e.fromEditable) return null;
    return 'toggle-tts';
  }

  // `?` (Shift+/) — open keyboard shortcut help overlay. KeyboardEvent.key
  // is '?' directly when shift+slash is pressed (modern browsers). No
  // Cmd/Ctrl required — single-finger discovery shortcut. Suppressed
  // inside editable surfaces (else `?` keystroke types the char).
  if (e.key === '?' && !isCmdOrCtrl(e) && !e.altKey) {
    if (e.fromEditable) return null;
    return 'open-help';
  }

  return null;
}

/** Minimum shape we need from an event target to decide editability —
 *  duck-typed so tests can stub without a real DOM (the PWA bun test
 *  env doesn't ship with `document`, mirroring the use-live-camera
 *  convention of "test pure pieces · cover DOM lifecycle in dogfood"). */
export interface EditableTargetShape {
  tagName?: string | null;
  getAttribute?: (name: string) => string | null;
}

/** Detect whether an event target is an editable surface (input,
 *  textarea, contenteditable). Used by ShowroomLayout to decide
 *  whether to pass `fromEditable: true` into `isShowroomShortcut`. */
export function targetIsEditable(target: EditableTargetShape | null | undefined): boolean {
  if (!target) return false;
  const tag = target.tagName;
  if (!tag) return false;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  // contenteditable === '' (empty string) also counts as editable per
  // the HTML spec — guard against the inherited 'false' / 'inherit'.
  const ce = target.getAttribute?.('contenteditable');
  if (ce === '' || ce === 'true') return true;
  return false;
}

/** Human-readable description of the shortcut catalog. Rendered by
 *  the FU.B3 help overlay (`?` to open). Kept here so the
 *  keys-and-effects table stays in one place — the overlay just
 *  iterates this array. */
export const SHORTCUT_DESCRIPTIONS: ReadonlyArray<{
  id: ShowroomShortcut;
  combo: string;
  effect: string;
}> = [
  { id: 'focus-broadcast-input', combo: '⌘K / Ctrl+K', effect: 'Focus broadcast input' },
  { id: 'toggle-role-judge', combo: '⌘⇧J / Ctrl+⇧J', effect: 'Toggle role-judge backend' },
  { id: 'toggle-voice', combo: '⌘⇧M / Ctrl+⇧M', effect: 'Toggle voice mode (mic)' },
  { id: 'toggle-tts', combo: '⌘⇧Y / Ctrl+⇧Y', effect: 'Toggle TTS mute' },
  { id: 'open-help', combo: '?', effect: 'Open this help overlay' },
];
