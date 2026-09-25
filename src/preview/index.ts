// ── Public preview API ──
//
// Single entry point for the TUI: pick a handler via router, run it,
// return a discriminated union. The UI (finder pane, image modal,
// attachment display) is responsible for turning `PreviewResult` into
// terminal output — `lines` goes straight into a markdown widget,
// `image` gets fed through renderImagePreview for ANSI block-art.
//
// Phase A only wires text/image/fallback. Later phases extend the
// switch below as handlers land — callers don't change.

import { statSync } from 'node:fs';
import { routeFile, type HandlerName } from './router.js';
import { runText } from './handlers/text.js';
import { runImage } from './handlers/image.js';
import { runPdf } from './handlers/pdf.js';
import { runSvg } from './handlers/svg.js';
import { runVideo } from './handlers/video.js';
import { runFont } from './handlers/font.js';
import { runArchive } from './handlers/archive.js';
import { runFolder } from './handlers/folder.js';
import { runFallback } from './handlers/fallback.js';

export type PreviewResult =
  | { kind: 'lines'; lines: string[] }
  | { kind: 'image'; cachePath: string };

export interface RunOpts {
  /** Page offset (PDF / video timestamp / archive scroll). */
  skip?: number;
  /** Viewport hint in cells — bat / chafa honor it. */
  cols?: number;
  rows?: number;
  /** Max text lines to emit. Default 400. */
  maxLines?: number;
}

export interface PreviewFileOpts extends RunOpts {
  /** Override handler selection (tests, manual routing). */
  forceHandler?: HandlerName;
}

export function previewFile(absPath: string, opts: PreviewFileOpts = {}): PreviewResult {
  const handler = opts.forceHandler ?? routeFile({
    absPath,
    isDirectory: isDir(absPath),
  });
  return dispatch(handler, absPath, opts);
}

function dispatch(handler: HandlerName, absPath: string, opts: RunOpts): PreviewResult {
  switch (handler) {
    case 'text':    return runText(absPath, opts);
    case 'image':   return runImage(absPath, opts);
    case 'pdf':     return runPdf(absPath, opts);
    case 'svg':     return runSvg(absPath, opts);
    case 'video':   return runVideo(absPath, opts);
    case 'font':    return runFont(absPath, opts);
    case 'archive': return runArchive(absPath, opts);
    case 'folder':  return runFolder(absPath, opts);
    case 'fallback':
    default:
      return runFallback(absPath, opts);
  }
}

function isDir(absPath: string): boolean {
  try { return statSync(absPath).isDirectory(); } catch { return false; }
}

export { routeFile } from './router.js';
export type { HandlerName } from './router.js';
