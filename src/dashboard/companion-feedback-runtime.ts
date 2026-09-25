export interface DashboardCompanionFeedbackRuntimeDeps {
  muted: (text: string) => string;
  warning: (text: string) => string;
}

export interface DashboardCompanionFeedbackRuntime {
  clipboardCopiedLine(charCount: number): string;
  clipboardWriteFailedLine(): string;
  memoSavedLine(lineCount: number): string;
  memoDiscardedLine(): string;
  memoCancelledLine(): string;
}

export function createDashboardCompanionFeedbackRuntime(
  deps: DashboardCompanionFeedbackRuntimeDeps,
): DashboardCompanionFeedbackRuntime {
  return {
    clipboardCopiedLine: (charCount) => deps.muted(`  copied ${charCount} chars to clipboard`),
    clipboardWriteFailedLine: () => deps.warning('  clipboard write failed'),
    memoSavedLine: (lineCount) => deps.muted(`  memo saved (${lineCount} line(s))`),
    memoDiscardedLine: () => deps.muted('  memo discarded (empty)'),
    memoCancelledLine: () => deps.muted('  memo cancelled'),
  };
}
