export interface DashboardWorkingDirAttachmentWarning {
  raw: string;
  reason: 'not-a-file' | 'not-found';
}

export interface DashboardWorkingDirAttachmentEntry {
  attachment: {
    kind: string;
  };
}

export interface DashboardWorkingDirAttachmentTokenizeResult {
  text: string;
  added: DashboardWorkingDirAttachmentEntry[];
  warnings: DashboardWorkingDirAttachmentWarning[];
}

export interface DashboardWorkingDirSelectionAttachmentDeps {
  tokenizeInput: (text: string) => DashboardWorkingDirAttachmentTokenizeResult;
  onWarning: (warning: DashboardWorkingDirAttachmentWarning) => void;
  renderAttachmentSummary: (added: DashboardWorkingDirAttachmentEntry[]) => void;
  appendInputPrefix: (text: string) => void;
}

export function attachDashboardWorkingDirSelection(
  paths: string[],
  deps: DashboardWorkingDirSelectionAttachmentDeps,
): void {
  if (paths.length === 0) return;
  const pathBlob = paths.map((path) => `"${path}"`).join(' ');
  const tokenized = deps.tokenizeInput(pathBlob);
  for (const warning of tokenized.warnings) deps.onWarning(warning);
  deps.renderAttachmentSummary(tokenized.added);
  const trimmed = tokenized.text.trim();
  if (trimmed) deps.appendInputPrefix(`${trimmed} `);
}
