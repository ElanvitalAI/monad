export interface DashboardStatusFeedbackRuntimeDeps {
  muted: (text: string) => string;
  success: (text: string) => string;
  error: (text: string) => string;
  pushChatLine: (line: string) => void;
  setChatScrollBottom: () => void;
}

export interface DashboardStatusFeedbackRuntime {
  onClipboardHistoryCleared(): void;
  onClipboardCompanionPopupToggled(open: boolean): void;
  onWidgetHostReloadStarted(): void;
  onWidgetHostReloadCompleted(): void;
  onWidgetHostReloadFailed(message: string): void;
}

export function createDashboardStatusFeedbackRuntime(
  deps: DashboardStatusFeedbackRuntimeDeps,
): DashboardStatusFeedbackRuntime {
  const pushMuted = (line: string): void => {
    deps.pushChatLine(deps.muted(line));
    deps.setChatScrollBottom();
  };

  return {
    onClipboardHistoryCleared: () => {
      pushMuted('  clipboard history cleared');
    },
    onClipboardCompanionPopupToggled: (open) => {
      pushMuted(`  clipboard companion popup ${open ? 'opened' : 'closed'}`);
    },
    onWidgetHostReloadStarted: () => {
      pushMuted('  widget-host: rescanning…');
    },
    onWidgetHostReloadCompleted: () => {
      deps.pushChatLine(deps.success('  widget-host: reload complete'));
      deps.setChatScrollBottom();
    },
    onWidgetHostReloadFailed: (message) => {
      deps.pushChatLine(deps.error(`  widget-host reload failed: ${message}`));
      deps.setChatScrollBottom();
    },
  };
}
