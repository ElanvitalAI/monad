// WT-N-2 — shared multipart upload helper for `/v1/attachments`.
//
// Centralised so:
//   - CameraAttachButton (WT-N-1) — single image
//   - FileAttachButton (WT-N-2) — Files.app picker, multi-file
//   - TerminalDropZone (WT-N-2) — drag-drop
//   - future /chat composer attachments
// all share auth header construction + error mapping + debug log
// taxonomy. Extracted from the original CameraAttachButton inline
// fetch so each call site stays a thin presentation layer.

import { debugLog } from './debug';

export interface AttachmentMeta {
  id: string;
  filename: string;
  mediaType: string;
  size: number;
  downloadUrl: string;
  createdAt?: number;
  /** Absolute path on the daemon host (e.g. `~/.monad/attachments/<id>-<name>`).
   *  Surfaced so PWA callers can inject it into the active web terminal
   *  the way `ctr.sh` pipes a path through the host clipboard — except
   *  daemon and PTY share the same fs, so no extra SCP hop. */
  path?: string;
}

export interface UploadAttachmentOpts {
  baseUrl: string;
  /** Optional bearer token. */
  token?: string;
  file: Blob;
  /** Override filename. Defaults to `(file as File).name` or `upload.bin`. */
  filename?: string;
}

export type UploadAttachmentResult =
  | { ok: true; meta: AttachmentMeta }
  | { ok: false; status: number; reason: string };

/** POST a single Blob to `<baseUrl>/v1/attachments` and return the
 *  resulting metadata (or a typed error). Caller handles the toast /
 *  UI state — this helper is fetch-only. */
export async function uploadAttachment(opts: UploadAttachmentOpts): Promise<UploadAttachmentResult> {
  const baseUrl = opts.baseUrl.replace(/\/$/, '');
  if (!baseUrl) {
    return { ok: false, status: 0, reason: 'baseUrl not configured' };
  }
  const filename = opts.filename
    ?? (opts.file instanceof File ? opts.file.name : 'upload.bin');
  debugLog('webterm.attach.upload.begin', {
    filename,
    size: opts.file.size,
    type: opts.file.type,
  });
  const form = new FormData();
  form.append('file', opts.file, filename);
  form.append('filename', filename);
  try {
    const res = await fetch(`${baseUrl}/v1/attachments`, {
      method: 'POST',
      body: form,
      ...(opts.token ? { headers: { authorization: `Bearer ${opts.token}` } } : {}),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      debugLog('webterm.attach.upload.error', {
        status: res.status,
        detail: detail.slice(0, 200),
      });
      return { ok: false, status: res.status, reason: detail || `HTTP ${res.status}` };
    }
    const meta = (await res.json()) as AttachmentMeta;
    debugLog('webterm.attach.upload.ok', { id: meta.id, size: meta.size });
    return { ok: true, meta };
  } catch (e) {
    const reason = String(e instanceof Error ? e.message : e);
    debugLog('webterm.attach.upload.exception', { reason });
    return { ok: false, status: 0, reason };
  }
}

/** Upload a batch of Blobs in parallel. Returns per-file results so
 *  the caller can show partial-success UI. */
export async function uploadAttachments(
  files: readonly { file: Blob; filename?: string }[],
  opts: { baseUrl: string; token?: string },
): Promise<UploadAttachmentResult[]> {
  return Promise.all(files.map((entry) => uploadAttachment({
    baseUrl: opts.baseUrl,
    ...(opts.token !== undefined ? { token: opts.token } : {}),
    file: entry.file,
    ...(entry.filename !== undefined ? { filename: entry.filename } : {}),
  })));
}
