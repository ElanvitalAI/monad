import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { TurnOutputMediaPreview } from '../input/turn-output-media-preview.js';

export interface DashboardMediaPreviewDownloadDeps {
  fetchImpl?: typeof fetch;
  tmpDir?: string;
  now?: () => number;
}

export interface DashboardMediaPreviewOpenSurfaceDeps {
  downloadPreview?: (
    preview: TurnOutputMediaPreview,
  ) => Promise<string>;
  showPreviewModal: (
    absPath: string,
    title: string,
  ) => Promise<void> | void;
}

function defaultExtFor(preview: TurnOutputMediaPreview): string {
  return preview.kind === 'picture' ? '.png' : '.mp4';
}

function extFromDataUrl(url: string, fallback: string): string {
  const match = url.match(/^data:([^;,]+)[;,]/i);
  const mime = match?.[1]?.toLowerCase() ?? '';
  if (!mime) return fallback;
  if (mime === 'image/svg+xml') return '.svg';
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/png') return '.png';
  if (mime === 'image/gif') return '.gif';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'video/mp4') return '.mp4';
  if (mime === 'video/webm') return '.webm';
  if (mime === 'video/quicktime') return '.mov';
  return fallback;
}

function extFromUrl(url: string, fallback: string): string {
  if (/^data:/i.test(url)) {
    return extFromDataUrl(url, fallback);
  }
  try {
    const parsed = new URL(url);
    const ext = path.extname(parsed.pathname || '').toLowerCase();
    return ext || fallback;
  } catch {
    return fallback;
  }
}

export async function downloadDashboardMediaPreviewToTempFile(
  preview: TurnOutputMediaPreview,
  deps: DashboardMediaPreviewDownloadDeps = {},
): Promise<string> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const res = await fetchImpl(preview.url);
  if (!res.ok) {
    throw new Error(`media preview fetch failed: ${res.status}`);
  }
  const ab = await res.arrayBuffer();
  const ext = extFromUrl(preview.url, defaultExtFor(preview));
  const outPath = path.join(
    deps.tmpDir ?? tmpdir(),
    `monad-media-preview-${deps.now?.() ?? Date.now()}${ext}`,
  );
  writeFileSync(outPath, Buffer.from(ab));
  return outPath;
}

export async function openDashboardMediaPreviewInSurface(
  preview: TurnOutputMediaPreview,
  deps: DashboardMediaPreviewOpenSurfaceDeps,
): Promise<void> {
  const downloader = deps.downloadPreview ?? ((p) => downloadDashboardMediaPreviewToTempFile(p));
  const absPath = await downloader(preview);
  await deps.showPreviewModal(absPath, preview.label);
}
