export interface DashboardFilePathAttachmentWarning {
  raw: string;
  reason: 'not-a-file' | 'not-found';
}

export interface DashboardFilePathAttachmentEntry {
  attachment: {
    kind: string;
  };
}

export interface DashboardFilePathAttachmentTokenizeResult {
  text: string;
  added: DashboardFilePathAttachmentEntry[];
  warnings: DashboardFilePathAttachmentWarning[];
}

export interface DashboardFilePathAttachmentDeps {
  tokenizeInput: (text: string) => DashboardFilePathAttachmentTokenizeResult;
  onWarning: (warning: DashboardFilePathAttachmentWarning) => void;
  renderAttachmentSummary: (added: DashboardFilePathAttachmentEntry[]) => void;
  markChanged: () => void;
}

export async function attachDashboardFilePathToken(
  absPath: string,
  deps: DashboardFilePathAttachmentDeps,
): Promise<string> {
  const tokenized = deps.tokenizeInput(`"${absPath}"`);
  for (const warning of tokenized.warnings) deps.onWarning(warning);
  deps.renderAttachmentSummary(tokenized.added);
  if (tokenized.added.length > 0 || tokenized.warnings.length > 0) deps.markChanged();
  const trimmed = tokenized.text.trim();
  return trimmed ? `${trimmed} ` : '';
}
