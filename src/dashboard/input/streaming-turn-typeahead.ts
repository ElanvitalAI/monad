import type { TurnTypeaheadState } from '../../chat/turn-typeahead.js';
import { restoreTurnTypeaheadSubmission } from '../../chat/turn-typeahead.js';

/** Executes a streaming slash submission and restores it to FIFO when the caller rejects it. */
export async function dispatchStreamingTurnTypeaheadSubmission(
  state: TurnTypeaheadState,
  text: string,
  dispatch: (text: string) => Promise<boolean>,
): Promise<TurnTypeaheadState> {
  try {
    return await dispatch(text) ? state : restoreTurnTypeaheadSubmission(state, text);
  } catch {
    return restoreTurnTypeaheadSubmission(state, text);
  }
}
