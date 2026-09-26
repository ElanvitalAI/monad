import { PreviewTerminal } from '../preview/terminal.js';
import type { PreviewTerminalOpts, SpawnFn } from '../preview/terminal.js';
import { debug } from '../debug/log.js';
import type {
  Action,
  DisplayHandle,
  DisplaySurface,
  KeyEvent,
  RenderCtx,
  SurfaceId,
  SurfaceOwner,
} from './types.js';
import type { DisplayEventBus } from './events.js';
import type { FocusManager } from '../primitives/focus-manager/index.js';

export type ExecutionMode = 'pty' | 'batch';
export type ExecutionPlacement = 'preview' | 'scratch' | 'modal' | 'split';

export interface ExecutionSurfaceSpec {
  id?: SurfaceId;
  mode?: ExecutionMode;
  command?: string;
  cwd: string;
  title?: string;
  focus?: boolean;
  placement?: ExecutionPlacement;
  cols?: number;
  rows?: number;
  shell?: string;
  env?: Record<string, string>;
  termName?: string;
}

export interface ExecutionTerminal {
  start(): void;
  stop(): void;
  resize(cols: number, rows: number): void;
  write(bytes: string): void;
  render(focused?: boolean): string;
  readonly isAlive: boolean;
}

export interface ExecutionSurfaceHandle {
  id: SurfaceId;
  surface: DisplaySurface;
  terminal: ExecutionTerminal;
  start(): void;
  stop(): void;
  resize(cols: number, rows: number): void;
  write(bytes: string): void;
  render(ctx: RenderCtx): string[];
  dispose(): void;
}

export interface ExecutionSurfaceFactoryOptions {
  display: DisplayHandle;
  /** F-3c (2026-04-22) — optional FocusManager primitive. When
   *  provided, `start()` focuses the mounted surface via the
   *  primitive directly (bypassing `display.focus()` wrapper).
   *  Falls back to the wrapper when omitted so existing tests +
   *  callers that haven't wired the primitive keep working. */
  focusManager?: FocusManager;
  owner?: SurfaceOwner;
  priority?: number;
  spawn?: SpawnFn;
  terminalFactory?: (opts: PreviewTerminalOpts, spawn?: SpawnFn) => ExecutionTerminal;
  events?: DisplayEventBus;
  now?: () => number;
  /** ⛔ `code: null` = exited, code unlearnable — never render it as 0. */
  onExit?: (id: SurfaceId, code: number | null) => void;
}

let nextExecutionId = 1;

export function createExecutionSurface(
  spec: ExecutionSurfaceSpec,
  opts: ExecutionSurfaceFactoryOptions,
): ExecutionSurfaceHandle {
  if ((spec.mode ?? 'pty') !== 'pty') {
    throw new Error(`unsupported execution surface mode: ${spec.mode}`);
  }

  const id = spec.id ?? `execution:${opts.now?.() ?? Date.now()}:${nextExecutionId++}`;
  const owner = opts.owner ?? opts.display.owner;
  const terminal = (opts.terminalFactory ?? defaultTerminalFactory)({
    cols: Math.max(2, spec.cols ?? 80),
    rows: Math.max(2, spec.rows ?? 24),
    cwd: spec.cwd,
    shell: spec.shell,
    env: spec.env,
    termName: spec.termName,
    onUpdate: () => {
      opts.events?.emit({ type: 'execution:update', id, status: 'output' });
      opts.display.requestRender({ region: id });
    },
    onExit: (code) => {
      opts.events?.emit({ type: 'execution:update', id, status: 'exited', payload: { code } });
      opts.onExit?.(id, code);
      opts.display.requestRender({ region: id });
    },
  }, opts.spawn);

  const render = (ctx: RenderCtx): string[] => {
    const cols = Math.max(2, ctx.width);
    const rows = Math.max(2, ctx.height);
    terminal.resize(cols, rows);
    return terminal.render(ctx.focused).split('\n');
  };

  const surface: DisplaySurface = {
    id,
    kind: 'execution',
    owner,
    focus: 'owns',
    priority: opts.priority ?? 0,
    render,
    onKey: (ev) => {
      if (ev.ctrl && ev.shift && terminalStopKey(ev)) {
        opts.display.publish({ type: 'closeSurface', id });
        return { type: 'refresh' };
      }
      const bytes = keyEventToTerminalBytes(ev);
      if (!bytes) return { type: 'none' };
      terminal.write(bytes);
      return { type: 'refresh' };
    },
    dispose: () => {
      terminal.stop();
    },
  };

  let mounted = false;
  let stopped = false;

  const handle: ExecutionSurfaceHandle = {
    id,
    surface,
    terminal,
    start() {
      if (mounted) return;
      terminal.start();
      if (spec.command) terminal.write(commandToInput(spec.command));
      opts.display.publish({ type: 'upsertSurface', surface });
      if (spec.focus ?? true) {
        // F-3c (2026-04-22) — primitive-direct focus. Prefer the
        // injected `focusManager` when wired (dashboard passes
        // `coord.focusManagerAPI()` at createExecutionSurface call
        // site). Fall back to legacy `display.focus()` wrapper so
        // existing tests + headless hosts keep working without the
        // primitive. Reason 'execution:mount' makes the transition
        // traceable in the `primitive.focus.focused` debug junction.
        if (opts.focusManager) {
          opts.focusManager.setFocus(id, 'execution:mount');
        } else {
          opts.display.focus(id);
        }
      }
      opts.events?.emit({
        type: 'execution:update',
        id,
        status: 'running',
        payload: {
          title: spec.title,
          cwd: spec.cwd,
          command: spec.command,
          placement: spec.placement ?? 'preview',
        },
      });
      mounted = true;
      stopped = false;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      opts.display.publish({ type: 'closeSurface', id });
      opts.events?.emit({ type: 'execution:update', id, status: 'stopped' });
      mounted = false;
    },
    resize(cols, rows) {
      terminal.resize(cols, rows);
      opts.events?.emit({ type: 'execution:update', id, status: 'resized', payload: { cols, rows } });
      opts.display.requestRender({ region: id });
    },
    write(bytes) {
      terminal.write(bytes);
      opts.events?.emit({ type: 'execution:update', id, status: 'input', payload: { bytes: bytes.length } });
      opts.display.requestRender({ region: id });
    },
    render,
    dispose() {
      handle.stop();
    },
  };

  return handle;
}

export function keyEventToTerminalBytes(ev: KeyEvent): string | null {
  // Order matters: try semantic translation FIRST. elanous's outer TUI
  // receives keystrokes in kitty keyboard protocol form (`CSI <code>;<mod> u`)
  // when the user's terminal is ghostty/kitty/etc. with kitty mode
  // enabled. tui.parseKey() decodes these into Key{name,ctrl,…} but
  // also retains the raw bytes on `ev.sequence`. If we returned the
  // raw kitty bytes first, the spawned PTY's child shell — which
  // does NOT have kitty mode enabled — would print them verbatim
  // (e.g. `643;5u` in the popup terminal when the user pressed
  // Ctrl+L). Always translate ctrl-letter / arrow / function keys
  // to their legacy bytes; only fall back to ev.sequence for keys
  // we don't have an explicit mapping for.
  const out = decodeKeyEvent(ev);
  if (debug.enabled) {
    debug.log('exec.surface.keyToBytes', ev.name || '(unnamed)', {
      name: ev.name,
      ctrl: ev.ctrl ?? false,
      shift: ev.shift ?? false,
      alt: ev.alt ?? false,
      hasSequence: ev.sequence !== undefined,
      sequencePreview: ev.sequence
        ? ev.sequence.replace(/\x1b/g, 'ESC').slice(0, 32)
        : null,
      out: out === null
        ? null
        : out.replace(/\x1b/g, 'ESC').slice(0, 32),
      outBytes: out === null
        ? null
        : Array.from(out).slice(0, 8).map((c) => c.charCodeAt(0)),
    });
  }
  return out;
}

function decodeKeyEvent(ev: KeyEvent): string | null {
  const name = (ev.name ?? '').toLowerCase();

  // Mouse events arrive on this path because the input-core dispatcher
  // routes any unhandled key-or-mouse event through the focused
  // surface's onKey. The raw bytes on `ev.sequence` are SGR 1006
  // mouse sequences (`ESC[<button;col;rowM`). Forwarding those to
  // a child shell that has NOT enabled DECSET 1000/1002/1003 makes
  // the bytes print as text (`[<0;55;36M` etc.). Drop them here —
  // proper mouse forwarding for mouse-aware children should go
  // through the dedicated `preview.forwardMouse(...)` path which
  // gates on mouseMode (see src/dashboard/index.ts:14319 for the
  // preview-pane variant). This protects the popup terminal modal,
  // /claude-vw, and any other plain PTY child from mouse-byte leak.
  if (name === 'mouse') return null;

  if (ev.ctrl && name.length === 1) {
    const code = name.charCodeAt(0);
    if (code >= 97 && code <= 122) {
      const ctrlByte = String.fromCharCode(code - 96);
      // Ctrl+Alt+letter → ESC + ctrl-byte (legacy alt-as-esc-prefix).
      // Without this, ev.sequence (kitty CSI-u) would leak verbatim.
      return ev.alt ? `\x1b${ctrlByte}` : ctrlByte;
    }
  }

  // Alt+letter / Alt+digit / Alt+symbol — emit as ESC+<char> so child
  // PTYs that don't speak kitty CSI-u see the canonical legacy
  // alt-as-esc-prefix encoding (matches ghostty's
  // `macos-option-as-alt` mode and tui.parseKey()'s decode of the
  // same). Without this, the ev.sequence fallback below would
  // forward `\x1b[<code>;3u` verbatim — same root cause as #788
  // (bare ev.sequence leaks kitty bytes to non-kitty children).
  if (ev.alt && !ev.ctrl && name.length === 1) {
    return `\x1b${ev.shift ? name.toUpperCase() : name}`;
  }

  switch (name) {
    case 'enter':
    case 'return':
      return '\r';
    case 'tab':
      return ev.shift ? '\x1b[Z' : '\t';
    case 'backspace':
      return '\x7f';
    case 'escape':
    case 'esc':
      return '\x1b';
    case 'up':
      return '\x1b[A';
    case 'down':
      return '\x1b[B';
    case 'right':
      return '\x1b[C';
    case 'left':
      return '\x1b[D';
    case 'home':
      return '\x1b[H';
    case 'end':
      return '\x1b[F';
    case 'pageup':
      return '\x1b[5~';
    case 'pagedown':
      return '\x1b[6~';
    case 'delete':
      return '\x1b[3~';
  }

  // Plain printable letter / digit / symbol — emit it directly.
  if (!ev.ctrl && !ev.alt && name.length === 1) {
    // Case-preserve exception: tui.parseKey()'s plain-text branch
    // (`return K(s)` at src/tui.ts:354) does not synthesize a shift
    // bit, so paste of an uppercase letter via Cmd+V — and Shift+letter
    // on legacy non-kitty terminals — arrives as `name='A', shift=false`.
    // Line 232 above lower-cases `name`, so the naive `shift ? upper :
    // lower` would forward 'a' to the child PTY. When `ev.sequence`
    // carries a single printable codepoint that differs from the
    // lower-cased `name` ONLY by case, prefer the original byte.
    // Korean IME jamo (e.g. 'ㅂ' → name='q') doesn't trigger this
    // because `'ㅂ'.toLowerCase() !== 'q'`, so Korean→English remap
    // continues to win.
    if (
      ev.sequence
      && ev.sequence.length === 1
      && ev.sequence !== name
      && ev.sequence.toLowerCase() === name
    ) {
      return ev.sequence;
    }
    return ev.shift ? name.toUpperCase() : name;
  }

  // Last resort: if the event carries raw bytes (a sequence we
  // didn't recognize semantically — e.g. F-keys, kitty-only IME
  // bytes), forward those. The child shell may or may not handle
  // them, but it's better than dropping the event.
  //
  // EXCEPT for SGR 1006 mouse sequences. tui.parseKey() handles
  // most mouse events as `name: 'mouse'` (caught above), but some
  // codepaths produce a Key with empty name + the raw SGR bytes
  // attached on `sequence` — observed for right-click release
  // (`ESC[<2;col;rowm`) and drag-motion variants. Forwarding those
  // to a child without DECSET 1000+ leaks the bytes as text. Drop
  // any sequence that matches the SGR mouse shape.
  if (ev.sequence && SGR_MOUSE_RE.test(ev.sequence)) return null;

  if (ev.sequence) return ev.sequence;

  return null;
}

// SGR 1006 mouse sequence: ESC [ < <btn> ; <col> ; <row> [Mm]
// — M = press, m = release. Used to filter raw mouse bytes that
// slipped past the `name === 'mouse'` early-return when the
// upstream parser returned an empty-named Key (e.g. right-click
// release, drag-end variants in tui.parseKey's `K('')` branch).
const SGR_MOUSE_RE = /^\x1b\[<\d+;\d+;\d+[Mm]$/;

function commandToInput(command: string): string {
  return command.endsWith('\r') || command.endsWith('\n') ? command : `${command}\r`;
}

function defaultTerminalFactory(opts: PreviewTerminalOpts, spawn?: SpawnFn): ExecutionTerminal {
  return new PreviewTerminal(opts, spawn);
}

function terminalStopKey(ev: KeyEvent): boolean {
  const name = (ev.name ?? '').toLowerCase();
  return name === 't' || name === 'ㅅ';
}
