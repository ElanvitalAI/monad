export const terminalPanelViews = ['terminal', 'observe', 'pty-list'] as const;

export type TerminalPanelView = typeof terminalPanelViews[number];

export interface TerminalPanelViewButton {
  view: TerminalPanelView;
  selected: boolean;
}

export interface TerminalPanelViewState {
  view: TerminalPanelView;
  buttons: readonly TerminalPanelViewButton[];
}

/**
 * Applies a toolbar selection. Re-selecting observation preserves its established
 * toggle-off behavior by returning to the terminal view.
 */
export function nextTerminalPanelView(
  current: TerminalPanelView,
  selected: TerminalPanelView,
): TerminalPanelView {
  return selected === 'observe' && current === 'observe' ? 'terminal' : selected;
}

/** Returns the render target and toolbar selection from one canonical view. */
export function terminalPanelViewState(view: TerminalPanelView): TerminalPanelViewState {
  return {
    view,
    buttons: terminalPanelViews.map((candidate) => ({
      view: candidate,
      selected: candidate === view,
    })),
  };
}
