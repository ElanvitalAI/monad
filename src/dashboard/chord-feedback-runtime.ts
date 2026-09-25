export interface DashboardChordFeedbackRuntimeDeps {
  pushMutedLine: (line: string) => void;
  setChatScrollBottom: () => void;
}

export interface DashboardChordFeedbackRuntime {
  onPaneClosed(label: string): void;
  onPanesReopened(): void;
  onPreviewTerminalExpandChanged(expanded: boolean): void;
  onMissingPreviewTerminal(): void;
}

export function createDashboardChordFeedbackRuntime(
  deps: DashboardChordFeedbackRuntimeDeps,
): DashboardChordFeedbackRuntime {
  const push = (line: string): void => {
    deps.pushMutedLine(line);
    deps.setChatScrollBottom();
  };

  return {
    onPaneClosed: (label) => {
      push(`${label} pane closed. ^B o restores panes; ^B m opens focused pane as a modal.`);
    },
    onPanesReopened: () => {
      push('All dashboard panes reopened.');
    },
    onPreviewTerminalExpandChanged: (expanded) => {
      push(
        expanded
          ? 'Terminal expanded. ^B e to restore.'
          : 'Terminal collapsed to preview slot.',
      );
    },
    onMissingPreviewTerminal: () => {
      push('No terminal running — ^B t to start one first.');
    },
  };
}
