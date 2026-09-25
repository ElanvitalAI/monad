// CV-3 mobile-readiness #4 · camera-intake helpers (Phase 0.5 ·
// 2026-05-08).
//
// Pure helper layer that the ShowroomCameraIntake component uses
// to (1) upload a photo blob to /v1/attachments and (2) optionally
// route it to /v1/intake with a user-supplied caption. The
// component handles UI state; this module is fetch-only +
// deterministic builders so unit tests can pin URL shape +
// payload composition.
//
// BACKLOG: 내부 문서 `BACKLOG-pwa-mobile-readiness-2026-05-08` §2.4
// Cross-ref: src/nexus/api/meta-api.ts handleIntakePost (POST /v1/intake)

import { uploadAttachment, type AttachmentMeta, type UploadAttachmentResult } from './upload-attachment';

export interface CameraIntakeRoute {
  /** 'session' = upload only · caller adds to session attachments.
   *  'intake'  = upload + POST /v1/intake with caption + ref. */
  kind: 'session' | 'intake';
}

export interface CameraIntakePostOpts {
  baseUrl: string;
  token?: string;
  /** Photo blob captured from the camera or file picker. */
  file: Blob;
  /** Optional filename override (camera capture defaults to a
   *  timestamped name). */
  filename?: string;
  /** Caption text the user entered. Required when route='intake'
   *  (the intake plane needs `text`); ignored when route='session'. */
  caption?: string;
  /** Where to route after upload. */
  route: CameraIntakeRoute;
  /** Optional fetch impl for tests. Production passes nothing →
   *  uses globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

export type CameraIntakeResult =
  | { ok: true; route: 'session'; meta: AttachmentMeta }
  | { ok: true; route: 'intake'; meta: AttachmentMeta; intakeId: string }
  | { ok: false; stage: 'upload'; status: number; reason: string }
  | { ok: false; stage: 'intake'; status: number; reason: string };

/** Default filename for a camera capture lacking `file.name`. */
export function defaultCameraFilename(now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-').toLowerCase();
  return `camera-${stamp}.jpg`;
}

/** Compose the intake POST body for a camera-attached photo.
 *  Pure — exposed for unit tests. */
export function buildIntakeBodyForPhoto(opts: {
  meta: AttachmentMeta;
  caption?: string;
  receivedAt?: string;
  intakeId?: string;
}): Record<string, unknown> {
  const meta = opts.meta;
  const captionText = opts.caption?.trim() ?? '';
  // Reference the attachment in the text body so the intake plane
  // (text-driven) can later associate the photo. The path is
  // surfaced for downstream tools that read fs directly; the URL
  // is included for browser-side recall.
  const attachLine = `[image: ${meta.filename}${meta.path ? ` · ${meta.path}` : ''}]`;
  const text = captionText ? `${attachLine} ${captionText}` : attachLine;
  const body: Record<string, unknown> = {
    text,
    actor: 'pwa-camera',
    channelContext: {
      kind: 'pwa-camera',
      attachmentId: meta.id,
      attachmentFilename: meta.filename,
      attachmentMediaType: meta.mediaType,
      ...(meta.path ? { attachmentPath: meta.path } : {}),
      ...(meta.downloadUrl ? { attachmentUrl: meta.downloadUrl } : {}),
    },
  };
  if (opts.receivedAt) body.receivedAt = opts.receivedAt;
  if (opts.intakeId) body.intakeId = opts.intakeId;
  return body;
}

/** Upload a camera blob and optionally route to /v1/intake.
 *
 *  Production wires an injected `uploadAttachmentImpl` for tests.
 *  Defaults to the shared upload-attachment helper so the camera
 *  intake doesn't drift from the broader /v1/attachments contract. */
export async function uploadCameraIntake(opts: CameraIntakePostOpts): Promise<CameraIntakeResult> {
  const filename = opts.filename
    ?? (opts.file instanceof File ? opts.file.name : undefined)
    ?? defaultCameraFilename();
  const upload = await uploadAttachment({
    baseUrl: opts.baseUrl,
    ...(opts.token !== undefined ? { token: opts.token } : {}),
    file: opts.file,
    filename,
  }) as UploadAttachmentResult;
  if (!upload.ok) {
    return { ok: false, stage: 'upload', status: upload.status, reason: upload.reason };
  }
  if (opts.route.kind === 'session') {
    return { ok: true, route: 'session', meta: upload.meta };
  }
  // route.kind === 'intake'
  const baseUrl = opts.baseUrl.replace(/\/$/, '');
  const fetchImpl = opts.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : null as unknown as typeof fetch);
  if (!fetchImpl) {
    return { ok: false, stage: 'intake', status: 0, reason: 'fetch unavailable' };
  }
  try {
    const body = buildIntakeBodyForPhoto({
      meta: upload.meta,
      ...(opts.caption !== undefined ? { caption: opts.caption } : {}),
    });
    const res = await fetchImpl(`${baseUrl}/v1/intake`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, stage: 'intake', status: res.status, reason: detail || `HTTP ${res.status}` };
    }
    const json = await res.json().catch(() => ({})) as { intakeId?: string };
    return {
      ok: true,
      route: 'intake',
      meta: upload.meta,
      intakeId: json.intakeId ?? '',
    };
  } catch (e) {
    const reason = String(e instanceof Error ? e.message : e);
    return { ok: false, stage: 'intake', status: 0, reason };
  }
}
