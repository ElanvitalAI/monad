export interface DashboardFinderFeedbackRuntimeDeps {
  muted: (text: string) => string;
  success: (text: string) => string;
  error: (text: string) => string;
  warning: (text: string) => string;
  pushChatLine: (line: string) => void;
  setChatScrollBottom: () => void;
}

export interface DashboardFinderScanCompletedOptions {
  count: number;
  backend: string;
  truncated: boolean;
  durationMs: number;
}

export interface DashboardSshConnectStartOptions {
  name: string;
  host: string;
}

export interface DashboardFinderFeedbackRuntime {
  onFinderScanStarted(target: string): void;
  onFinderScanCompleted(options: DashboardFinderScanCompletedOptions): void;
  onFinderScanEmpty(): void;
  onFinderFailed(message: string): void;
  onSshConnectStarted(options: DashboardSshConnectStartOptions): void;
  onSshConnectSucceeded(name: string): void;
  onSshConnectFailed(name: string, message: string): void;
}

export function createDashboardFinderFeedbackRuntime(
  deps: DashboardFinderFeedbackRuntimeDeps,
): DashboardFinderFeedbackRuntime {
  const pushMuted = (line: string): void => {
    deps.pushChatLine(deps.muted(line));
    deps.setChatScrollBottom();
  };

  return {
    onFinderScanStarted: (target) => {
      pushMuted(`  scanning ${target}…`);
    },
    onFinderScanCompleted: ({ count, backend, truncated, durationMs }) => {
      pushMuted(
        `  ${count} file${count === 1 ? '' : 's'} (${backend}${truncated ? ', capped' : ''}) in ${durationMs}ms`,
      );
    },
    onFinderScanEmpty: () => {
      deps.pushChatLine(deps.warning('  no files found in the current tree.'));
      deps.setChatScrollBottom();
    },
    onFinderFailed: (message) => {
      deps.pushChatLine(deps.error(`  finder failed: ${message}`));
      deps.setChatScrollBottom();
    },
    onSshConnectStarted: ({ name, host }) => {
      pushMuted(`  connecting to ${name} (${host})…`);
    },
    onSshConnectSucceeded: (name) => {
      deps.pushChatLine(deps.success(`  ✓ remote ${name}`));
      deps.setChatScrollBottom();
    },
    onSshConnectFailed: (name, message) => {
      deps.pushChatLine(deps.error(`  ssh ${name} failed: ${message}`));
      deps.setChatScrollBottom();
    },
  };
}
