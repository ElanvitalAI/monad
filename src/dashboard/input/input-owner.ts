export type InputOwner =
  | 'question-view'
  | 'overlay-input'
  | 'vw-local-composer'
  | 'chat-main'
  | 'none';

export interface InputOwnerState {
  chatMainFocused: boolean;
  chatMainAvailable?: boolean;
  vwLocalComposerActive: boolean;
  overlayInputActive: boolean;
  questionActive?: boolean;
}

export interface InputOwnershipSnapshot {
  owner: InputOwner;
  chatMainSuppressed: boolean;
  vwLocalComposerSuppressed: boolean;
}

/** Canonical foreground input owner priority for dashboard-era
 *  multi-input routing. The key distinction is state isolation:
 *  chat-main, each VW local composer, and transient overlay inputs
 *  keep separate draft/cursor state even when suppressed.
 *
 *  Policy note:
 *    - `vw-local-composer` belongs to the current foreground
 *      workspace (`VirtualWindow`)
 *    - `overlay-input` is reserved for blocking popup/dialog/menu/
 *      picker surfaces, not companion / embedded-overlay helpers
 *
 *  Priority:
 *    1. question-view       — active AskUserQuestion response input
 *    2. overlay-input       — picker query / dialog text input / popup input
 *    3. vw-local-composer   — current foreground VW's local composer
 *    4. chat-main           — dashboard global chat composer
 *    5. none
 */
export function deriveInputOwner(state: InputOwnerState): InputOwner {
  if (state.questionActive) return 'question-view';
  if (state.overlayInputActive) return 'overlay-input';
  if (state.vwLocalComposerActive) return 'vw-local-composer';
  if ((state.chatMainAvailable ?? true) && state.chatMainFocused) return 'chat-main';
  return 'none';
}

/** Canonical ownership snapshot for foreground dashboard inputs.
 *
 *  Use this helper when a caller needs both the winning owner and the
 *  suppression state of the other composers. This keeps popup dismiss
 *  -> workspace/local-composer restoration on the same vocabulary as
 *  chat-main visibility checks. */
export function deriveInputOwnershipSnapshot(
  state: InputOwnerState,
): InputOwnershipSnapshot {
  const owner = deriveInputOwner(state);
  return {
    owner,
    chatMainSuppressed: owner !== 'chat-main',
    vwLocalComposerSuppressed: owner !== 'vw-local-composer',
  };
}

export function isChatMainSuppressed(state: InputOwnerState): boolean {
  return deriveInputOwnershipSnapshot(state).chatMainSuppressed;
}

export function isVwLocalComposerSuppressed(state: InputOwnerState): boolean {
  return deriveInputOwnershipSnapshot(state).vwLocalComposerSuppressed;
}
