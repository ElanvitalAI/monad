// ── Capture Phase 0.5 — ANSI → cell grid parser ──
//
// Minimal parser that turns an ANSI string into a 2-D cell grid suitable
// for SVG/PNG rendering. Intentionally narrow scope:
//   - SGR (select graphic rendition) sequences update fg/bg/bold/italic/
//     underline/inverse
//   - `\n` advances row, `\r` resets column, `\t` expands to next 8-col
//     tab stop
//   - Other CSI sequences (cursor motion, erase, scroll) are STRIPPED
//     but not interpreted — correct behavior for inputs that come from
//     `PreviewTerminal.render()` or `Pane.snapshot({format:'ansi'})`,
//     which already emit cell-flattened output (no motion codes).
//
// Full emulator semantics (alt buffer, DEC private modes, OSC) live in
// `preview-terminal.ts`; this parser is deliberately lighter so the
// SVG encoder can stay pure-TS with no xterm dependency.
//
// See: 내부 문서 `CAPABILITIES-capture-engine` §5

export interface CellAttr {
  readonly fg?: string;     // CSS color string (hex/rgb/named). undefined → default fg.
  readonly bg?: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly inverse?: boolean;
}

export interface Cell {
  readonly char: string;
  readonly attr: CellAttr;
}

export interface CellGrid {
  readonly rows: readonly (readonly Cell[])[];
  /** Max columns observed (not the rendering viewport width). */
  readonly cols: number;
}

/** Default 16-color palette — xterm-compatible approximations. Indexed
 *  0-15: black/red/green/yellow/blue/magenta/cyan/white · same order
 *  for bright (8-15). Exported so the SVG encoder can use the same
 *  table for any post-parse customization. */
export const PALETTE_16: readonly string[] = [
  '#000000', '#cd0000', '#00cd00', '#cdcd00',
  '#0000ee', '#cd00cd', '#00cdcd', '#e5e5e5',
  '#7f7f7f', '#ff0000', '#00ff00', '#ffff00',
  '#5c5cff', '#ff00ff', '#00ffff', '#ffffff',
];

/** 256-color palette resolver. Indexes 0-15 = PALETTE_16, 16-231 =
 *  6×6×6 cube, 232-255 = grayscale. */
export function palette256(i: number): string {
  if (i < 16) return PALETTE_16[i]!;
  if (i < 232) {
    const n = i - 16;
    const r = Math.floor(n / 36);
    const g = Math.floor((n % 36) / 6);
    const b = n % 6;
    const hex = (v: number) => (v === 0 ? 0 : 55 + v * 40).toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  }
  const gray = (i - 232) * 10 + 8;
  const h = gray.toString(16).padStart(2, '0');
  return `#${h}${h}${h}`;
}

export function ansiToCells(input: string): CellGrid {
  const rows: Cell[][] = [[]];
  let cur: CellAttr = {};
  let col = 0;
  let maxCols = 0;

  const pushCell = (ch: string): void => {
    rows[rows.length - 1]!.push({ char: ch, attr: cur });
    col++;
    if (col > maxCols) maxCols = col;
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;

    // CSI sequence: ESC [ ... final-byte
    if (ch === '\x1b' && input[i + 1] === '[') {
      let j = i + 2;
      let params = '';
      while (j < input.length) {
        const c = input[j]!;
        if ((c >= '0' && c <= '9') || c === ';' || c === ':' || c === '?') {
          params += c;
          j++;
        } else break;
      }
      const final = input[j];
      if (final === 'm') {
        cur = applySgr(cur, params);
      }
      // Other CSI finals: drop silently (caller's input shouldn't contain
      // motion codes; see module header).
      i = j;
      continue;
    }

    // OSC sequence: ESC ] ... (BEL | ST)
    if (ch === '\x1b' && input[i + 1] === ']') {
      let j = i + 2;
      while (j < input.length && input[j] !== '\x07' && input[j] !== '\x1b') j++;
      if (input[j] === '\x1b' && input[j + 1] === '\\') j++; // consume ST
      i = j;
      continue;
    }

    if (ch === '\n') {
      rows.push([]);
      col = 0;
      continue;
    }
    if (ch === '\r') {
      col = 0;
      continue;
    }
    if (ch === '\t') {
      const next = (Math.floor(col / 8) + 1) * 8;
      while (col < next) pushCell(' ');
      continue;
    }
    if (ch === '\x1b' || ch === '\x00' || ch === '\x07') continue;
    pushCell(ch);
  }

  return { rows, cols: Math.max(maxCols, 1) };
}

function applySgr(prev: CellAttr, params: string): CellAttr {
  // Empty "\x1b[m" is equivalent to "\x1b[0m" — reset.
  const parts = (params === '' ? ['0'] : params.split(';')).map((s) =>
    s === '' ? 0 : Number(s),
  );
  let i = 0;
  let next: CellAttr = { ...prev };
  while (i < parts.length) {
    const p = parts[i]!;
    if (p === 0) { next = {}; i++; continue; }
    if (p === 1) { next = { ...next, bold: true }; i++; continue; }
    if (p === 3) { next = { ...next, italic: true }; i++; continue; }
    if (p === 4) { next = { ...next, underline: true }; i++; continue; }
    if (p === 7) { next = { ...next, inverse: true }; i++; continue; }
    if (p === 22) { const { bold: _b, ...rest } = next; next = rest; i++; continue; }
    if (p === 23) { const { italic: _b, ...rest } = next; next = rest; i++; continue; }
    if (p === 24) { const { underline: _b, ...rest } = next; next = rest; i++; continue; }
    if (p === 27) { const { inverse: _b, ...rest } = next; next = rest; i++; continue; }
    if (p >= 30 && p <= 37) { next = { ...next, fg: PALETTE_16[p - 30]! }; i++; continue; }
    if (p === 38) {
      // 38;5;N  or  38;2;R;G;B
      if (parts[i + 1] === 5 && parts[i + 2] !== undefined) {
        next = { ...next, fg: palette256(parts[i + 2]!) };
        i += 3; continue;
      }
      if (parts[i + 1] === 2 && parts[i + 2] !== undefined
          && parts[i + 3] !== undefined && parts[i + 4] !== undefined) {
        next = { ...next, fg: rgb(parts[i + 2]!, parts[i + 3]!, parts[i + 4]!) };
        i += 5; continue;
      }
      i++; continue;
    }
    if (p === 39) { const { fg: _f, ...rest } = next; next = rest; i++; continue; }
    if (p >= 40 && p <= 47) { next = { ...next, bg: PALETTE_16[p - 40]! }; i++; continue; }
    if (p === 48) {
      if (parts[i + 1] === 5 && parts[i + 2] !== undefined) {
        next = { ...next, bg: palette256(parts[i + 2]!) };
        i += 3; continue;
      }
      if (parts[i + 1] === 2 && parts[i + 2] !== undefined
          && parts[i + 3] !== undefined && parts[i + 4] !== undefined) {
        next = { ...next, bg: rgb(parts[i + 2]!, parts[i + 3]!, parts[i + 4]!) };
        i += 5; continue;
      }
      i++; continue;
    }
    if (p === 49) { const { bg: _b, ...rest } = next; next = rest; i++; continue; }
    if (p >= 90 && p <= 97) { next = { ...next, fg: PALETTE_16[p - 90 + 8]! }; i++; continue; }
    if (p >= 100 && p <= 107) { next = { ...next, bg: PALETTE_16[p - 100 + 8]! }; i++; continue; }
    // Unknown — skip.
    i++;
  }
  return next;
}

function rgb(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.floor(v)));
  const hex = (v: number) => clamp(v).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
