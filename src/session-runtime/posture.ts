// Session posture state — canonical home for the runtime's
// general/control posture model. Legacy chat-mode wrappers re-export
// from here while dashboard/session-runtime migrate away from
// dashboard-specific naming.

export type ChatMode = 'default' | 'dashboard-control';
export type ChatPosture = 'general' | 'control';

export interface ChatModeState {
  /** Normalized persistent posture used by runtime code. */
  posture: ChatPosture;
  /** Legacy UI-facing mode label kept for compatibility while the
   *  runtime migrates away from dashboard-specific naming. */
  mode: ChatMode;
  /** epoch ms when last entered `mode`. Used by the HUD badge so the
   *  user sees how long they've been in control mode. */
  enteredAt: number;
  /** Optional one-line reason the user gave on entry ("fix the build",
   *  "split a new pane"). Surfaced by the manual header so the LLM
   *  sees the most recent intent. */
  intent: string | null;
  /** Optional explicit surface hint such as `coding/agent` or
   *  `research/agent`. When unset, the runtime falls back to intent
   *  and posture-based surface resolution. */
  preferredSurfaceId: string | null;
  /** Quick-Control one-shot flag. When set, THIS turn runs as if the
   *  control posture were active even though the legacy `mode` label
   *  stays `default`. */
  quickControlOnce: boolean;
}

export function createChatModeState(): ChatModeState {
  return {
    posture: 'general',
    mode: 'default',
    enteredAt: Date.now(),
    intent: null,
    preferredSurfaceId: null,
    quickControlOnce: false,
  };
}

export interface EnterModeOpts {
  intent?: string;
  now?: () => number;
}

export function enterControlMode(state: ChatModeState, opts: EnterModeOpts = {}): ChatModeState {
  const now = opts.now ?? (() => Date.now());
  state.posture = 'control';
  state.mode = 'dashboard-control';
  state.enteredAt = now();
  state.intent = opts.intent?.trim() || null;
  return state;
}

export function exitControlMode(state: ChatModeState, opts: EnterModeOpts = {}): ChatModeState {
  const now = opts.now ?? (() => Date.now());
  state.posture = 'general';
  state.mode = 'default';
  state.enteredAt = now();
  state.intent = null;
  state.preferredSurfaceId = null;
  return state;
}

export function isControlMode(state: ChatModeState): boolean {
  return state.posture === 'control' || state.quickControlOnce === true;
}

export function armQuickControlOnce(state: ChatModeState, intent?: string): ChatModeState {
  state.quickControlOnce = true;
  if (intent) state.intent = intent.trim() || state.intent;
  return state;
}

export function consumeQuickControlOnce(state: ChatModeState): boolean {
  if (!state.quickControlOnce) return false;
  state.quickControlOnce = false;
  if (state.posture !== 'control') state.intent = null;
  return true;
}

export function toggleControlMode(state: ChatModeState, opts: EnterModeOpts = {}): ChatModeState {
  return state.posture === 'control'
    ? exitControlMode(state, opts)
    : enterControlMode(state, opts);
}

export function setPreferredSurface(
  state: ChatModeState,
  preferredSurfaceId: string | null,
): ChatModeState {
  state.preferredSurfaceId = preferredSurfaceId?.trim() || null;
  return state;
}

export function modeElapsedLabel(state: ChatModeState, now: number = Date.now()): string {
  const s = Math.floor((now - state.enteredAt) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h`;
}

export type ControlSlashOutcome =
  | { kind: 'enter'; intent: string }
  | { kind: 'exit'; source: 'control' | 'default'; alreadyDefault: boolean };

export function parseControlSlash(
  command: 'control' | 'dm' | 'default',
  args: string[],
  currentlyControl: boolean,
): ControlSlashOutcome {
  if (command === 'default') {
    return { kind: 'exit', source: 'default', alreadyDefault: !currentlyControl };
  }
  const sub = (args[0] ?? '').toLowerCase();
  if (sub === 'off' || sub === 'exit') {
    return { kind: 'exit', source: 'control', alreadyDefault: !currentlyControl };
  }
  return { kind: 'enter', intent: args.join(' ').trim() };
}
