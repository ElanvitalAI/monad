// Pane capture — VW-P8.
//
// Pull a text snapshot of any pane regardless of kind. Default mode
// delegates to pane.capture() (which every PaneContent implements);
// 'ocr' mode attempts a tesseract subprocess when the pane's text
// capture is empty / user explicitly requested OCR.
//
// OCR path:
//   1. render pane's grid
//   2. if non-empty text, return it (no OCR needed)
//   3. if empty + tesseract available, pipe the grid through `tesseract`
//   4. if tesseract missing, return a clear error string
//
// In practice, our panes always return text because all our
// built-in kinds produce ANSI grids with actual glyphs. OCR is a
// compatibility shim for future image-only panes (e.g. a terminal
// displaying kitty-graphics that we can't read programmatically).

import { spawn } from 'node:child_process';
import { truncateOutput } from '../output-truncation.js';
import type { AddressBook } from './addressing.js';
import { stripAnsi } from '../tui.js';

export type CaptureMode = 'text' | 'ocr' | 'auto';

export interface CaptureOpts {
  mode?: CaptureMode;
  maxBytes?: number;
  /** Override tesseract probe for tests. */
  ocrBackend?: OcrBackend;
}

export interface OcrBackend {
  available(): Promise<boolean> | boolean;
  run(input: string): Promise<string>;
}

export interface CaptureResult {
  addr: string;
  kind: string;
  mode: CaptureMode;
  body: string;
  truncated: boolean;
  ocrBackendUsed: boolean;
}

export const DEFAULT_CAPTURE_MAX_BYTES = 64 * 1024;

export async function capturePane(
  addressBook: AddressBook,
  addr: string,
  opts: CaptureOpts = {},
): Promise<CaptureResult | null> {
  const pane = addressBook.resolvePane(addr);
  if (!pane) return null;
  // AddressBook gives us {id, windowId, kind}. For the actual
  // capture we need the PaneContent — the book only stores
  // metadata. The host wires the content into the registry; here
  // we re-fetch through a helper the host registers.
  const content = paneContentLookup(pane.id);
  if (!content) return null;

  const mode = opts.mode ?? 'auto';
  const maxBytes = opts.maxBytes ?? DEFAULT_CAPTURE_MAX_BYTES;
  let body = '';
  let usedOcr = false;

  try { body = content.capture(); } catch { body = ''; }
  // Strip ANSI for readability when caller requests text mode —
  // auto mode keeps ANSI because LLMs can read it just fine.
  if (mode === 'text') body = stripAnsi(body);

  const textLooksEmpty = stripAnsi(body).trim().length === 0;
  if ((mode === 'ocr' || (mode === 'auto' && textLooksEmpty))) {
    const backend = opts.ocrBackend ?? defaultOcrBackend;
    try {
      if (await backend.available()) {
        body = await backend.run(body);
        usedOcr = true;
      } else if (mode === 'ocr') {
        body = '[OCR backend unavailable — install tesseract]';
      }
    } catch (err) {
      body = `[OCR error: ${err instanceof Error ? err.message : String(err)}]`;
    }
  }

  const trimmed = truncateOutput(body, { toolName: 'pane_capture', ext: 'log', inlineLimit: maxBytes });
  return {
    addr: `pane:${pane.id}`,
    kind: pane.kind,
    mode,
    body: trimmed.output,
    truncated: trimmed.spilled,
    ocrBackendUsed: usedOcr,
  };
}

// ─── PaneContent lookup hook ──────────────────────────────────────
// The address book only stores metadata; capture needs the actual
// PaneContent. A host registers a lookup fn here.

let paneContentLookupFn: (id: string) => { capture: () => string } | null = () => null;

export function registerPaneContentLookup(
  fn: (id: string) => { capture: () => string } | null,
): void {
  paneContentLookupFn = fn;
}
function paneContentLookup(id: string) { return paneContentLookupFn(id); }

// ─── Default OCR backend (tesseract) ──────────────────────────────

const tesseractProbe = (() => {
  let cached: boolean | null = null;
  return async (): Promise<boolean> => {
    if (cached !== null) return cached;
    cached = await new Promise<boolean>((resolve) => {
      const p = spawn('tesseract', ['--version'], { stdio: 'ignore' });
      p.on('error', () => resolve(false));
      p.on('exit', (code) => resolve(code === 0));
    });
    return cached;
  };
})();

export const defaultOcrBackend: OcrBackend = {
  available: () => tesseractProbe(),
  async run(input: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('tesseract', ['-', '-'], {
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      let out = '';
      proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
      proc.on('error', reject);
      proc.on('exit', (code) => code === 0 ? resolve(out) : reject(new Error(`tesseract exit ${code}`)));
      proc.stdin.write(input);
      proc.stdin.end();
    });
  },
};
