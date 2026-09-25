import type { Attachment } from '../context.js';
import type { AttachmentPopupAction } from '../log-pane/attachment-popup.js';

export interface DashboardAttachmentPopupActionDeps {
  dropContextById: (id: number) => boolean;
  forgetAttachmentRowById: (id: number) => void;
  onDropResult: (ok: boolean, attachment: Attachment) => void;
  writeClipboardDetailed: (text: string) => Promise<{ ok: boolean; via?: string | null }>;
  onCopied: (label: string, result: { ok: boolean; via?: string | null }) => void;
}

export function handleDashboardAttachmentPopupAction(
  action: AttachmentPopupAction,
  attachment: Attachment,
  deps: DashboardAttachmentPopupActionDeps,
): void {
  if (action === 'drop') {
    const ok = deps.dropContextById(attachment.id);
    deps.forgetAttachmentRowById(attachment.id);
    deps.onDropResult(ok, attachment);
    return;
  }
  if (action === 'copy-token') {
    void deps.writeClipboardDetailed(attachment.token).then((result) => {
      deps.onCopied(attachment.token, result);
    });
    return;
  }
  if (action === 'copy-path') {
    void deps.writeClipboardDetailed(attachment.sourcePath).then((result) => {
      deps.onCopied('path', result);
    });
  }
}
