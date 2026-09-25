import type {
  TextInputExternalSubmitRequest,
  TextInputGlobalAction,
  TextInputHost,
} from '../../chat/index.js';

export interface CreateChatMainInputHostDeps {
  promptCtl: {
    repaint: () => void;
    insertAtCursor?: (text: string) => void;
    submit?: (request?: string | TextInputExternalSubmitRequest) => void;
  };
  setInputLines: (visibleLines: number) => boolean;
  redraw: () => void;
  dispatchGlobalAction: (action: TextInputGlobalAction) => void | Promise<void>;
}

export function createChatMainInputHost(
  deps: CreateChatMainInputHostDeps,
): TextInputHost {
  return {
    control: deps.promptCtl,
    onLinesChange: (n) => {
      if (!deps.setInputLines(n)) return;
      deps.redraw();
      // Dashboard redraw is microtask-coalesced. Repaint the live input in
      // the following microtask so the resized frame cannot overwrite its
      // newly added top rows.
      queueMicrotask(() => deps.promptCtl.repaint());
    },
    dispatchGlobalAction: async (action) => {
      await deps.dispatchGlobalAction(action);
      deps.redraw();
      deps.promptCtl.repaint();
    },
  };
}
