import type { ChatMainTextInputBaseOpts } from './chat-main-turn.js';

export interface DashboardAttachmentTokenizedWarning {
  raw: string;
  reason: 'not-a-file' | 'not-found';
}

export interface DashboardAttachmentTokenizedEntry {
  attachment: {
    kind: string;
  };
}

export interface DashboardAttachmentTokenizeResult {
  text: string;
  added: DashboardAttachmentTokenizedEntry[];
  warnings: DashboardAttachmentTokenizedWarning[];
}

export type DashboardChatMainAttachmentOpts = Pick<
  ChatMainTextInputBaseOpts,
  'onPaste' | 'onAtPick' | 'onAtFolderAttach' | 'onTokenDeleted'
>;

export function createDashboardChatMainAttachmentOpts(
  deps: {
    tokenizeInput: (text: string) => DashboardAttachmentTokenizeResult;
    attachClipboardImage: () => Promise<string | null>;
    isClipboardSupported: () => boolean;
    onWarning: (warning: DashboardAttachmentTokenizedWarning) => void;
    renderAttachmentSummary: (added: DashboardAttachmentTokenizedEntry[]) => void;
    clearClipboardImageIndicator: () => void;
    markChatDirty: () => void;
    attachFilePathToken: (absPath: string) => Promise<string>;
    openFolderAttachModal: (absPath: string, resolve: (value: string) => void) => void;
    dropContextById: (id: number) => void;
    sweepAttachmentSummaryLines: (token: string) => number;
  },
): DashboardChatMainAttachmentOpts {
  return {
    onPaste: async (text) => {
      const tok = deps.tokenizeInput(text);
      for (const warning of tok.warnings) {
        deps.onWarning(warning);
      }
      deps.renderAttachmentSummary(tok.added);
      if (tok.added.length > 0) deps.markChatDirty();

      let extra = '';
      if (tok.added.length === 0 && tok.text.trim() === '' && deps.isClipboardSupported()) {
        try {
          const imgToken = await deps.attachClipboardImage();
          if (imgToken) {
            extra = imgToken;
            deps.clearClipboardImageIndicator();
          }
        } catch { /* swallow — leave buffer unchanged */ }
      } else if (tok.added.some((entry) => entry.attachment.kind === 'image')) {
        deps.clearClipboardImageIndicator();
      }

      if (tok.warnings.length > 0 || extra) deps.markChatDirty();
      return tok.text + extra;
    },
    onAtPick: async (absPath) => await deps.attachFilePathToken(absPath),
    onAtFolderAttach: (absPath) =>
      new Promise<string>((resolve) => {
        deps.openFolderAttachModal(absPath, resolve);
      }),
    onTokenDeleted: (token, stillReferenced) => {
      if (stillReferenced) return;

      const match = token.match(/\[(?:Image|Text|Md|PDF|Docx|Xlsx) #(\d+)\]/);
      if (!match) return;
      const id = parseInt(match[1]!, 10);
      deps.dropContextById(id);

      const removed = deps.sweepAttachmentSummaryLines(token);
      if (removed > 0) deps.markChatDirty();
    },
  };
}
