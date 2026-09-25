// ── General-purpose preview modal ──
//
// Wraps previewFile() + showTransientTerminalModal. Routes any file
// through the preview handler pipeline (text/image/pdf/svg/video/
// font/archive/folder/fallback), then:
//   - `{kind:'lines'}` → lines go straight into the modal body
//   - `{kind:'image'}` → cache path goes through renderImagePreview
//                        (chafa/viu) to produce ANSI block-art lines
//
// Superseded dashboard-image-modal.ts (removed once its last caller
// migrated). Group='image-preview' so successive calls auto-dismiss
// the previous preview.

import { basename } from 'node:path';
import { previewFile, type PreviewFileOpts, type PreviewResult } from '../../preview/index.js';
import { renderImagePreview } from '../../image/preview.js';
import {
  showTransientTerminalModal,
  type TransientTerminalModalHandle,
} from './transient.js';
import type { DisplayCoordinator } from '../../display/coordinator.js';
import type { ModalBounds } from '../../display/modal-stack.js';
import { isKgpTerminal } from '../../kgp/capabilities.js';
import { renderImageKGP, type KgpRenderResult } from '../../kgp/pipeline.js';

export interface ShowPreviewModalOpts {
  title?: string;
  /** Coordinator to push the modal into. */
  coordinator: DisplayCoordinator;
  /** Host terminal dimensions. Used to auto-size + center. */
  termCols: number;
  termRows: number;
  /** Dismiss delay. 0 = persistent (ESC-only). Default 3500ms —
   *  longer than the attachment flash since preview content is
   *  typically read, not glanced at. */
  ttlMs?: number;
  /** Paging offset forwarded to the handler (PDF page / video %). */
  skip?: number;
  /** DI for tests — swaps the preview pipeline and/or the ANSI
   *  renderer without touching real files or external tools. */
  renderer?: typeof renderImagePreview;
  previewer?: (absPath: string, opts: PreviewFileOpts) => PreviewResult;
  /** Override bounds. Used by the finder picker's 2-pane mode to
   *  place the preview NEXT TO the picker rather than centered.
   *  When set, takes precedence over the default centering. */
  bounds?: ModalBounds;
  /** Override the singleton group key. Default 'image-preview' for
   *  back-compat; the 2-pane finder mode uses its own group so the
   *  preview doesn't collide with unrelated previews. */
  group?: string;
}

export interface ShowPreviewModalReturn {
  handle: TransientTerminalModalHandle;
  /** The underlying handler output, in case the caller wants to
   *  branch on kind for status-bar hints (e.g. "j/k to page"). */
  result: PreviewResult;
}

export async function showPreviewModal(
  absPath: string,
  opts: ShowPreviewModalOpts,
): Promise<ShowPreviewModalReturn | null> {
  const previewer = opts.previewer ?? previewFile;
  const renderImg = opts.renderer ?? renderImagePreview;

  const result = previewer(absPath, { skip: opts.skip });
  const rendered = await linesFor(result, renderImg, opts);
  if (!rendered || rendered.lines.length === 0) return null;
  const { lines, kgp } = rendered;

  // Phase 3 — KGP upload happens BEFORE the modal paints so Kitty has
  // the image in its cache by the time the placeholder grid renders.
  // Writing directly to stdout bypasses the coordinator's cell-based
  // paint path, which is required — APC bytes aren't cell content.
  if (kgp) {
    try { process.stdout.write(kgp.uploadBytes); } catch { /* TTY closed */ }
  }

  const modalCols = Math.max(40, Math.min(opts.termCols - 8, Math.floor(opts.termCols * 0.7)));
  const handle = showTransientTerminalModal({
    title: opts.title ?? titleFor(absPath, result, opts.skip),
    lines,
    coordinator: opts.coordinator,
    termCols: opts.termCols,
    termRows: opts.termRows,
    // bounds (when set) wins over width/height — see
    // ShowTransientTerminalModalParams. Used by the finder picker's
    // 2-pane mode to dock the preview alongside the picker.
    ...(opts.bounds ? { bounds: opts.bounds } : { width: modalCols, height: lines.length + 2 }),
    ttlMs: opts.ttlMs ?? 3500,
    group: opts.group ?? 'image-preview',
    onDispose: kgp ? () => {
      // Erase the uploaded image when the modal closes (TTL, ESC, or
      // replacement). Keeps Kitty's image cache bounded over a long
      // dashboard session.
      try { process.stdout.write(kgp.cleanupSeq); } catch { /* TTY closed */ }
    } : undefined,
  });

  return { handle, result };
}

interface RenderedLines {
  lines: string[];
  /** Present iff the image was rendered via KGP. Caller uploads the
   *  bytes + registers the delete-on-dispose hook. */
  kgp?: KgpRenderResult;
}

async function linesFor(
  result: PreviewResult,
  renderImg: typeof renderImagePreview,
  opts: ShowPreviewModalOpts,
): Promise<RenderedLines | null> {
  if (result.kind === 'lines') {
    // Trim to modal height budget so we don't overflow.
    const budget = Math.max(6, Math.min(opts.termRows - 6, Math.floor(opts.termRows * 0.7))) - 2;
    return { lines: result.lines.slice(0, budget) };
  }

  const artCols = Math.max(16, Math.min(80, Math.floor(opts.termCols * 0.6)));
  const artRows = Math.max(8, Math.min(40, Math.floor(opts.termRows * 0.6)));

  // KGP branch — native Ghostty/Kitty render. Falls through to chafa
  // block-art on any failure so a malformed image doesn't leave the
  // pane empty.
  if (isKgpTerminal()) {
    try {
      const k = await renderImageKGP(result.cachePath, { cols: artCols, rows: artRows });
      if (k && k.placeholderLines.length > 0) {
        return { lines: k.placeholderLines, kgp: k };
      }
    } catch { /* fall through to chafa */ }
  }

  try {
    const lines = await renderImg(result.cachePath, { cols: artCols, rows: artRows });
    return lines ? { lines } : null;
  } catch {
    return null;
  }
}

function titleFor(absPath: string, r: PreviewResult, skip: number | undefined): string {
  const base = basename(absPath);
  if (r.kind === 'image' && typeof skip === 'number' && skip > 0) {
    return `${base} · page ${skip + 1}`;
  }
  return base;
}
