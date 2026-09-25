import { readFileSync } from 'fs';
import type { Attachment } from '../context.js';
import { renderImagePreview } from '../image/preview.js';
import { colorLine } from '../panes/syntax-color.js';
import { C } from '../tui.js';
import { scratchImageSize } from '../views/ui-mode.js';

export interface RichScratchViewersDeps {
  setDetailViewer: (title: string, lines: string[]) => void;
  termSize: () => { rows: number; cols: number };
  fmtBytes: (n: number) => string;
}

export interface RichScratchViewers {
  setScratchImage: (sourcePath: string, filename: string) => Promise<void>;
  setScratchFile: (attachment: Attachment) => void;
}

/** Rich-only scratch image/file preview. Callers pass the three closed-over
 *  values; this module does not read `showDashboard` state. */
export function createRichScratchViewers(deps: RichScratchViewersDeps): RichScratchViewers {
  const { setDetailViewer, termSize, fmtBytes } = deps;

  /** Render `absPath` via chafa and drop the ANSI block into the
   *  detail viewer with the filename as the title. Fire-and-forget
   *  so the caller (image-attach paths) doesn't pay the subprocess
   *  latency. */
  const setScratchImage = async (absPath: string, label: string): Promise<void> => {
    const { rows: tr, cols: tc } = termSize();
    // Scratchpad shares the top half of the screen with browser +
    // preview, so size the chafa render against the scratchpad's
    // approximate column allocation, not the whole terminal.
    const { rows: scratchRows, cols: scratchCols } = scratchImageSize(tr, tc);
    let lines: string[] | null = null;
    try { lines = await renderImagePreview(absPath, { cols: scratchCols, rows: scratchRows }); }
    catch { lines = null; }
    if (!lines || lines.length === 0) {
      setDetailViewer(label, [C.muted('(image render failed — install chafa to preview)')]);
      return;
    }
    setDetailViewer(label, lines);
  };

  /** Drop a text-file preview into the detail viewer — same shape the
   *  preview pane uses for files (line-numbered, syntax-colored).
   *  Used for non-image attachments and other read-only inspect flows. */
  const setScratchFile = (a: Attachment): void => {
    const lines: string[] = [];
    if (a.kind === 'pdf' || a.kind === 'docx' || a.kind === 'xlsx') {
      lines.push(C.muted(`  (${a.kind.toUpperCase()} \u2014 ${fmtBytes(a.sizeBytes)})`));
      lines.push('');
      lines.push(C.muted('  Body extracted at submit; preview not available here.'));
      setDetailViewer(a.filename, lines);
      return;
    }
    // Plain text / markdown — read + colorize like preview does.
    let raw: string;
    try { raw = readFileSync(a.sourcePath, 'utf-8'); }
    catch { setDetailViewer(a.filename, [C.muted('  (unable to read)')]); return; }
    // Attachment carries no ext field, so peel it off the filename
    // (matching the regex tokenizer's view of the path).
    const dot = a.filename.lastIndexOf('.');
    const ext = dot > 0 ? a.filename.slice(dot) : '';
    const body = raw.split('\n').slice(0, 200);
    for (let i = 0; i < body.length; i++) {
      const ln = C.muted(String(i + 1).padStart(4) + ' \u2502 ');
      lines.push(`${ln}${colorLine(body[i]!, ext)}`);
    }
    const total = raw.split('\n').length;
    if (total > body.length) {
      lines.push(C.muted(`  ... +${total - body.length} more lines`));
    }
    setDetailViewer(a.filename, lines);
  };

  return { setScratchImage, setScratchFile };
}
