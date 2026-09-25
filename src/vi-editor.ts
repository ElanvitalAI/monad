// Simple vi-style text editor — T3-C1.
//
// Single-file in-memory editor with three modes (normal / insert /
// command-line). Designed to slot into the dashboard's preview pane
// so the browser pane's `e` key opens a file for quick edits.
//
// Supported keys:
//
//   Normal mode
//     h j k l          movement (single cell)
//     0 $              line start / end
//     w b              next / previous word start
//     gg G             top / bottom of buffer
//     i a              insert before / after cursor
//     o O              open line below / above
//     x                delete char under cursor
//     dd               delete line
//     yy               yank (copy) line
//     p                put (paste) after cursor
//     u                undo
//     :                enter command-line mode
//
//   Insert mode
//     Esc              return to normal
//     Enter            newline
//     Backspace        delete previous char
//     printable        insert at cursor
//
//   Command-line mode
//     :w               save (caller-side persist via onSave())
//     :q               quit (blocked if dirty)
//     :q!              force quit (discards edits)
//     :wq / :x         save + quit
//     Esc / Backspace  cancel / edit buffer
//
// The module is UI-agnostic — render() returns a string array the
// caller paints wherever (preview pane, modal, test harness).
// Undo history is capped at 50 entries so a long editing session
// doesn't leak memory.
//
// NOT supported (deliberate MVP cuts): visual mode, search /? /n,
// registers, buffer splits, marks, autocommands. The scope is
// "fix a line and save" — not a full vim clone.

export type ViMode = 'normal' | 'insert' | 'command';

export interface ViRenderOpts {
  cols: number;
  rows: number;
  /** 1-indexed line number of the top row to render. Caller drives
   *  scroll by passing a shifted value. Default 1. */
  topLine?: number;
  /** When true, paint a status line at the bottom. Default true. */
  showStatus?: boolean;
}

export interface ViEditorState {
  mode: ViMode;
  row: number;        // 0-indexed
  col: number;        // 0-indexed
  topLine: number;    // 1-indexed
  dirty: boolean;
  filePath: string;
  lines: string[];
  commandBuffer: string;
  message: string;
  yanked: string | null;
  quitRequested: boolean;
  savedRequested: boolean;
  discardedRequested: boolean;
}

export interface ViEditorHandle {
  getState(): ViEditorState;
  getText(): string;
  isDirty(): boolean;
  onKey(ev: { name: string; ctrl?: boolean; shift?: boolean; sequence?: string }): void;
  render(opts: ViRenderOpts): string[];
  /** Clear transient message (caller may call after display). */
  clearMessage(): void;
}

interface Snapshot {
  lines: string[];
  row: number;
  col: number;
}

const UNDO_CAP = 50;

export interface CreateViEditorOpts {
  filePath: string;
  initialText: string;
}

export function createViEditor(opts: CreateViEditorOpts): ViEditorHandle {
  const state: ViEditorState = {
    mode: 'normal',
    row: 0,
    col: 0,
    topLine: 1,
    dirty: false,
    filePath: opts.filePath,
    lines: opts.initialText.length === 0 ? [''] : opts.initialText.split('\n'),
    commandBuffer: '',
    message: '',
    yanked: null,
    quitRequested: false,
    savedRequested: false,
    discardedRequested: false,
  };

  const undoStack: Snapshot[] = [];

  function snapshot(): void {
    undoStack.push({
      lines: state.lines.slice(),
      row: state.row,
      col: state.col,
    });
    if (undoStack.length > UNDO_CAP) undoStack.shift();
  }

  function clampCursor(): void {
    if (state.row < 0) state.row = 0;
    if (state.row >= state.lines.length) state.row = state.lines.length - 1;
    const line = state.lines[state.row] ?? '';
    const max = Math.max(0, state.mode === 'insert' ? line.length : line.length - 1);
    if (state.col < 0) state.col = 0;
    if (state.col > max) state.col = max;
  }

  function currentLine(): string { return state.lines[state.row] ?? ''; }
  function setLine(i: number, v: string): void { state.lines[i] = v; }

  function normalKey(name: string, shift: boolean): void {
    switch (name) {
      case 'h': state.col--; break;
      case 'l': state.col++; break;
      case 'j': state.row++; break;
      case 'k': state.row--; break;
      case '0': state.col = 0; break;
      case '$': state.col = Math.max(0, currentLine().length - 1); break;
      case 'w': {
        const l = currentLine();
        let c = state.col;
        while (c < l.length && /\S/.test(l[c] ?? '')) c++;
        while (c < l.length && /\s/.test(l[c] ?? '')) c++;
        if (c < l.length) {
          state.col = c;
        } else if (state.row < state.lines.length - 1) {
          state.row++;
          state.col = 0;
        }
        break;
      }
      case 'b': {
        const l = currentLine();
        let c = state.col - 1;
        while (c > 0 && /\s/.test(l[c] ?? '')) c--;
        while (c > 0 && /\S/.test(l[c - 1] ?? '')) c--;
        if (c >= 0) {
          state.col = c;
        } else if (state.row > 0) {
          state.row--;
          state.col = Math.max(0, currentLine().length - 1);
        }
        break;
      }
      case 'g':
        if (state.commandBuffer === 'g') {
          state.row = 0; state.col = 0; state.commandBuffer = '';
        } else {
          state.commandBuffer = 'g';
        }
        return;
      case 'G':
        if (shift || name === 'G') {
          state.row = state.lines.length - 1;
          state.col = 0;
          state.commandBuffer = '';
        }
        break;
      case 'i':
        state.mode = 'insert';
        break;
      case 'a':
        state.mode = 'insert';
        state.col++;
        break;
      case 'o': {
        snapshot();
        state.lines.splice(state.row + 1, 0, '');
        state.row++;
        state.col = 0;
        state.mode = 'insert';
        state.dirty = true;
        break;
      }
      case 'O': {
        snapshot();
        state.lines.splice(state.row, 0, '');
        state.col = 0;
        state.mode = 'insert';
        state.dirty = true;
        break;
      }
      case 'x': {
        const line = currentLine();
        if (line.length === 0) break;
        snapshot();
        const col = Math.min(state.col, line.length - 1);
        setLine(state.row, line.slice(0, col) + line.slice(col + 1));
        state.dirty = true;
        break;
      }
      case 'd':
        if (state.commandBuffer === 'd') {
          snapshot();
          state.lines.splice(state.row, 1);
          if (state.lines.length === 0) state.lines.push('');
          if (state.row >= state.lines.length) state.row = state.lines.length - 1;
          state.col = 0;
          state.dirty = true;
          state.commandBuffer = '';
        } else {
          state.commandBuffer = 'd';
        }
        return;
      case 'y':
        if (state.commandBuffer === 'y') {
          state.yanked = currentLine();
          state.message = '1 line yanked';
          state.commandBuffer = '';
        } else {
          state.commandBuffer = 'y';
        }
        return;
      case 'p': {
        if (state.yanked === null) break;
        snapshot();
        state.lines.splice(state.row + 1, 0, state.yanked);
        state.row++;
        state.col = 0;
        state.dirty = true;
        break;
      }
      case 'u': {
        const prev = undoStack.pop();
        if (prev) {
          state.lines = prev.lines;
          state.row = prev.row;
          state.col = prev.col;
          if (undoStack.length === 0) state.dirty = false;
        } else {
          state.message = 'nothing to undo';
        }
        break;
      }
      case ':':
        state.mode = 'command';
        state.commandBuffer = '';
        return;
    }
    state.commandBuffer = '';
    clampCursor();
  }

  function insertKey(name: string, shift: boolean, sequence?: string): void {
    if (name === 'escape') {
      state.mode = 'normal';
      if (state.col > 0) state.col--;
      clampCursor();
      return;
    }
    if (name === 'enter') {
      snapshot();
      const line = currentLine();
      setLine(state.row, line.slice(0, state.col));
      state.lines.splice(state.row + 1, 0, line.slice(state.col));
      state.row++;
      state.col = 0;
      state.dirty = true;
      return;
    }
    if (name === 'backspace') {
      if (state.col === 0 && state.row === 0) return;
      snapshot();
      if (state.col === 0) {
        const prevLen = (state.lines[state.row - 1] ?? '').length;
        state.lines[state.row - 1] = (state.lines[state.row - 1] ?? '') + currentLine();
        state.lines.splice(state.row, 1);
        state.row--;
        state.col = prevLen;
      } else {
        const line = currentLine();
        setLine(state.row, line.slice(0, state.col - 1) + line.slice(state.col));
        state.col--;
      }
      state.dirty = true;
      return;
    }
    // Printable character
    let ch = name.length === 1 ? name : '';
    if (!ch && sequence && sequence.length === 1) ch = sequence;
    if (!ch) return;
    if (shift && ch.length === 1 && /[a-z]/.test(ch)) ch = ch.toUpperCase();
    snapshot();
    const line = currentLine();
    setLine(state.row, line.slice(0, state.col) + ch + line.slice(state.col));
    state.col++;
    state.dirty = true;
  }

  function commandKey(name: string, sequence?: string): void {
    if (name === 'escape') {
      state.mode = 'normal';
      state.commandBuffer = '';
      return;
    }
    if (name === 'enter') {
      const cmd = state.commandBuffer;
      state.commandBuffer = '';
      state.mode = 'normal';
      switch (cmd) {
        case 'w':
          state.savedRequested = true;
          state.message = `"${state.filePath}" write requested`;
          break;
        case 'q':
          if (state.dirty) {
            state.message = 'E37: No write since last change (add ! to override)';
          } else {
            state.quitRequested = true;
          }
          break;
        case 'q!':
          state.discardedRequested = true;
          state.quitRequested = true;
          break;
        case 'wq':
        case 'x':
          state.savedRequested = true;
          state.quitRequested = true;
          state.message = `"${state.filePath}" write + quit`;
          break;
        default:
          state.message = `E492: Not an editor command: ${cmd}`;
      }
      return;
    }
    if (name === 'backspace') {
      state.commandBuffer = state.commandBuffer.slice(0, -1);
      return;
    }
    const ch = name.length === 1 ? name : (sequence && sequence.length === 1 ? sequence : '');
    if (ch) state.commandBuffer += ch;
  }

  return {
    getState: () => state,
    getText: () => state.lines.join('\n'),
    isDirty: () => state.dirty,
    clearMessage: () => { state.message = ''; },

    onKey: (ev) => {
      const name = ev.name ?? '';
      const shift = !!ev.shift;
      if (state.mode === 'insert') {
        insertKey(name, shift, ev.sequence);
        return;
      }
      if (state.mode === 'command') {
        commandKey(name, ev.sequence);
        return;
      }
      normalKey(name, shift);
    },

    render: (opts) => {
      const showStatus = opts.showStatus !== false;
      const bodyRows = showStatus ? Math.max(1, opts.rows - 1) : opts.rows;
      const top = Math.max(1, opts.topLine ?? state.topLine);
      const startIdx = top - 1;
      const out: string[] = [];
      for (let i = 0; i < bodyRows; i++) {
        const lineIdx = startIdx + i;
        const raw = state.lines[lineIdx] ?? '~';
        out.push(raw.slice(0, opts.cols));
      }
      if (showStatus) {
        const modeStr = state.mode === 'insert' ? '-- INSERT --'
          : state.mode === 'command' ? `:${state.commandBuffer}`
          : state.message || '';
        const pos = `${state.row + 1}:${state.col + 1}`;
        const flag = state.dirty ? '[+]' : '   ';
        const path = state.filePath.length > opts.cols - 20
          ? '…' + state.filePath.slice(-(opts.cols - 21))
          : state.filePath;
        const left = `${modeStr}`.padEnd(Math.max(0, opts.cols - path.length - pos.length - 8));
        const status = `${left}${flag} ${path} ${pos}`;
        out.push(status.slice(0, opts.cols));
      }
      return out;
    },
  };
}
