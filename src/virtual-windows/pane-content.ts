// PaneContent abstraction — VW-P2.
//
// Every pane in a VirtualWindow is backed by a PaneContent
// implementation. The interface is the same regardless of what's
// inside (live PTY / static markdown / LLM chat buffer / scratch
// pad); callers render + key-route + capture uniformly.
//
// Design patterns:
//   • Factory: createPaneContent(spec, deps) maps kind → concrete
//     constructor. registerPaneContentKind opens the registry for
//     plugin-contributed content types.
//   • Observer: .on('update'|'output'|'exit', cb) lets the event
//     bus subscribe without the content type knowing anything
//     about the bus.
//   • Delegation: VirtualWindow.render delegates per-pane to
//     content.render; VirtualWindow.onKey delegates to content
//     when a printable/non-navigation key survives the prefix
//     chord.

import { PreviewTerminal, type PreviewTerminalOpts, type SpawnFn } from '../preview/terminal.js';
import { keyEventToTerminalBytes } from '../display/execution-surface.js';
import { mintPaneId, type PaneId } from './addressing.js';
import { getSessionCwd } from '../session/working-dir.js';
import {
  isPtyForwardMouseEventType,
  type KeyEvent,
  type Action,
  type DisplayMouseEvent,
} from '../display/types.js';
import {
  interactiveTerminalExposure,
  type TerminalExposureSnapshot,
} from '../terminal/posture.js';
import {
  describeTerminalPosture,
  resolveTerminalInteractionPolicy,
} from '../terminal/tui-policy.js';
import type { CursorState } from '../display/cursor-state.js';
import type { HostChromeProfile } from '../display/host-chrome-profile.js';
import type { BrowserPaneRegistry } from '../browser-pane/registry.js';
import type { BrowserPaneModel } from '../browser-pane/model.js';
import type { PreviewPaneRegistry } from '../preview-pane/registry.js';
import {
  parseBlocks as parseMarkdownBlocks,
  renderParsedBlocks as renderParsedMarkdownBlocks,
} from '../expression/renderer/markdown.js';
import { C, ansi, visibleWidth, stripAnsi, wrapAnsiByWidth } from '../tui.js';
import { createPtyTailPaneContent } from './pty-tail-content.js';
import { createTerminalSlotContent } from './terminal-slot-content.js';
import { getTerminalMatrix } from '../terminal-matrix/index.js';

export type PaneContentKind = 'terminal' | 'terminal-slot' | 'markdown' | 'llm-chat' | 'scratch' | 'pty-tail' | 'acp-bg' | string;

export type PaneEventKind = 'update' | 'output' | 'exit';
export type PaneUnsubscribe = () => void;

export interface PaneRenderCtx {
  cols: number;
  rows: number;
  focused: boolean;
}

export interface PaneCursorCtx extends PaneRenderCtx {
  row: number;
  col: number;
}

export type PaneBroadcastMode = 'submit' | 'replace';

export interface PaneBroadcast {
  mode: PaneBroadcastMode;
  text: string;
}

export type PaneFocusPolicy = 'interactive' | 'output-only';

export interface PaneContent {
  readonly id: PaneId;
  readonly kind: PaneContentKind;
  readonly title: string;
  readonly focusPolicy: PaneFocusPolicy;
  readonly hostChromeProfile?: HostChromeProfile;
  start(): void;
  stop(): void;
  /** Returns ANSI grid as newline-joined lines, sized to ctx. */
  render(ctx: PaneRenderCtx): string;
  /** Optional physical cursor claim for IME/preedit anchoring. */
  cursor?(ctx: PaneCursorCtx): CursorState | null;
  onKey(ev: KeyEvent): Action;
  /** MD5 — optional mouse handler. Coord `ev.row`/`ev.col` are
   *  1-indexed absolute terminal coordinates (same as DisplayMouseEvent
   *  elsewhere in the app); the pane host is responsible for
   *  translating into pane-local space if it cares. Return
   *  `{ type: 'none' }` to pass through. `click` and `double-click`
   *  are both delivered verbatim — browseMode-style panes should
   *  use `double-click` for activation. Static/read-only content
   *  types (markdown, scratch, pty-tail) may omit this entirely. */
  onMouse?(ev: DisplayMouseEvent): Action;
  /** Send raw bytes (stdin for PTY, user message for chat, insert
   *  for scratch). */
  write(bytes: string): void;
  /** Intent-aware delivery path for VW local composer and other
   *  mixed-lane broadcasts. When omitted, callers may fall back to
   *  `write()` but lose kind-specific submit semantics. */
  acceptBroadcast?(input: PaneBroadcast): void;
  /** Best-effort text snapshot for capture/observe tools. */
  capture(): string;
  readonly isAlive: boolean;
  on(event: PaneEventKind, cb: (payload?: unknown) => void): PaneUnsubscribe;
  /** Called when the pane is removed from its window. Implementations
   *  should release any underlying resources (PTY, timers, etc.). */
  dispose(): void;
}

/** Lightweight observer base — shared by content types that don't
 *  already have their own emitter (markdown + scratch). */
function createObserver(): {
  emit: (ev: PaneEventKind, payload?: unknown) => void;
  on: (ev: PaneEventKind, cb: (payload?: unknown) => void) => PaneUnsubscribe;
} {
  const subs = new Map<PaneEventKind, Set<(p?: unknown) => void>>();
  return {
    emit(ev, payload) {
      const s = subs.get(ev);
      if (!s) return;
      for (const cb of s) { try { cb(payload); } catch { /* swallow */ } }
    },
    on(ev, cb) {
      let s = subs.get(ev);
      if (!s) { s = new Set(); subs.set(ev, s); }
      s.add(cb);
      return () => { s!.delete(cb); };
    },
  };
}

// ─── Specs ────────────────────────────────────────────────────────

export type PaneContentSpec =
  | {
      kind: 'terminal';
      title?: string;
      cmd?: string;
      cwd?: string;
      shell?: string;
      termName?: string;
      env?: Record<string, string>;
      cols?: number;
      rows?: number;
    }
  | { kind: 'markdown'; title?: string; text: string }
  | { kind: 'llm-chat'; title?: string; provider: string; model?: string; systemPrompt?: string; seed?: string }
  | { kind: 'scratch'; title?: string; initialText?: string }
  | {
      /** V3 (bg-terminal): read-mostly view of an already-spawned
       *  registry PTY. The pane does NOT own the PTY lifecycle —
       *  PtyShellStart/Kill do. Refreshes snapshot on a short timer
       *  so output streaming looks live without event-bus wiring. */
      kind: 'pty-tail';
      title?: string;
      ptyId: string;
      /** Snapshot refresh interval. Default 250ms. */
      refreshMs?: number;
    }
  | {
      /** T3b-a: wrap an existing TerminalInstance's PreviewTerminal
       *  in a VW slot. Full bidirectional interactivity; the slot
       *  does NOT own the PTY (matrix does), so placement transitions
       *  move the same PTY across surfaces without respawn. */
      kind: 'terminal-slot';
      title?: string;
      terminalId: string;
    }
  | {
      /** ACP follow-up #2 — read-only view of a live BackgroundManager
       *  record. Pane renders the BG session's fullOutput tail + state
       *  badge; subscribes to `onStateChange` + a 250ms timer for
       *  liveness. Does NOT own the underlying ACP subprocess (DRM
       *  does), so closing the pane leaves the BG session alive. Wiring
       *  lives in `src/acp/vw-join-bridge.ts`. */
      kind: 'acp-bg';
      title?: string;
      backgroundId: string;
    }
  | {
      /** ACP live lane — interactive pane backed directly by an ACP
       *  client session. Concrete wiring lives in
       *  `src/acp/vw-live-bridge.ts`; the base pane-content factory
       *  only needs the spec shape so custom kind registration can
       *  pass validation at spawn time. */
      kind: 'acp-live';
      title?: string;
      sessionId: string;
      backendId: string;
    };

export interface PaneFactoryDeps {
  spawn?: SpawnFn;
  terminalFactory?: (opts: PreviewTerminalOpts, spawn?: SpawnFn) => PreviewTerminal;
  /** Host-side terminal surface intent seam. PTY forwarding may drop
   * synthetic events like double-click, but monad still preserves the
   * surface intent here for selection / copy / inspection layers. */
  onTerminalMouseIntent?: (ev: DisplayMouseEvent, meta: {
    paneId: PaneId;
    paneKind: 'terminal';
    exposure: TerminalExposureSnapshot;
    interactionPolicy: ReturnType<typeof resolveTerminalInteractionPolicy>;
  }) => void;
  /**
   * PR-1 of multi-platform substrate ROADMAP — caller-supplied posture
   * for the VW terminal pane. Replaces the previous hard-coded
   * `interactiveTerminalExposure()` so mouse intents carry truthful
   * exposure based on the underlying handle's status rather than
   * always claiming user-interactive.
   *
   * Returning null falls back to the legacy interactive default for
   * backwards compatibility — callers without registry wiring still
   * get the previous behavior. New callers should plumb a real
   * registry-backed lookup.
   */
  resolveTerminalPanePosture?: (paneId: PaneId) => TerminalExposureSnapshot | null;
  /** Chat content needs a delegate to actually call an LLM.
   *  Factory passes `llmChatBackend?(req) => AsyncIterable<chunk>` if
   *  the host has one wired; otherwise chat panes surface a stub
   *  error line. */
  llmChatBackend?: (req: {
    provider: string;
    model?: string;
    messages: Array<{ role: 'system'|'user'|'assistant'; content: string }>;
  }) => AsyncIterable<string>;
  browserPaneRegistry?: BrowserPaneRegistry;
  previewPaneRegistry?: PreviewPaneRegistry;
  refreshRemoteBrowserPane?: (state: BrowserPaneModel) => Promise<void>;
  iulThemePreviewControl?: {
    getActiveThemeName: () => string;
    previewTheme: (name: string) => void;
    revertPreview: () => void;
    commitTheme: (name: string) => void;
  };
}

// ─── Terminal content ─────────────────────────────────────────────

export function createTerminalPaneContent(
  spec: Extract<PaneContentSpec, { kind: 'terminal' }>,
  deps: PaneFactoryDeps,
): PaneContent {
  const id = mintPaneId();
  const obs = createObserver();
  let started = false;

  const factory = deps.terminalFactory ?? ((o, s) => new PreviewTerminal(o, s));
  const preview = factory({
    cols: Math.max(2, spec.cols ?? 80),
    rows: Math.max(2, spec.rows ?? 24),
    cwd: spec.cwd ?? getSessionCwd(),
    shell: spec.shell,
    env: spec.env,
    termName: spec.termName,
    onUpdate: () => obs.emit('update'),
    onExit: (code) => { obs.emit('exit', code); },
  }, deps.spawn);

  const pane: PaneContent = {
    id,
    kind: 'terminal',
    title: spec.title ?? (spec.cmd ? spec.cmd.split(/\s+/)[0]! : 'shell'),
    focusPolicy: 'interactive',
    start() {
      if (started) return;
      started = true;
      preview.start();
      if (spec.cmd) {
        const cmd = spec.cmd.endsWith('\n') || spec.cmd.endsWith('\r')
          ? spec.cmd
          : spec.cmd + '\r';
        preview.write(cmd);
      }
    },
    stop() {
      try { preview.stop(); } catch { /* ignore */ }
    },
    render(ctx) {
      preview.resize(Math.max(2, ctx.cols), Math.max(2, ctx.rows));
      return preview.render(ctx.focused);
    },
    onKey(ev) {
      const bytes = keyEventToTerminalBytes(ev);
      if (!bytes) return { type: 'none' };
      preview.write(bytes);
      return { type: 'refresh' };
    },
    // MD5 — forward mouse to the PTY via SGR 1006 so terminal
    // applications (vim / less / tmux / btop) can react. Our
    // synthetic double-click has no PTY representation — dropping
    // it keeps terminal apps from seeing a ghost press they can't
    // parse. Drag / scroll / click / release flow verbatim.
    onMouse(ev) {
      // PR-1 — prefer caller-supplied posture (registry-backed) over the
      // legacy hard-coded interactive default. When no caller resolver,
      // self-derive from preview's alive state: live preview → interactive,
      // dead → unavailable. This matches external-terminal-pane.ts wiring
      // pattern and replaces PR #1333's permanent `interactive` claim.
      const fallback: TerminalExposureSnapshot = preview.isAlive
        ? interactiveTerminalExposure()
        : { userExposure: 'unavailable', agentInteractive: false };
      const exposure = deps.resolveTerminalPanePosture?.(id) ?? fallback;
      const posture = describeTerminalPosture(exposure);
      deps.onTerminalMouseIntent?.(ev, {
        paneId: id,
        paneKind: 'terminal',
        exposure: posture.exposure,
        interactionPolicy: posture.interactionPolicy,
      });
      // IDX-F5d — widget-synthesized double-click + hover motion have
      // no SGR 1006 representation; drop before forwarding so the PTY
      // never sees a ghost event it can't parse.
      if (!isPtyForwardMouseEventType(ev.type)) return { type: 'none' };
      preview.forwardMouse({ type: ev.type, row: ev.row, col: ev.col });
      return { type: 'refresh' };
    },
    write(bytes) {
      preview.write(bytes);
    },
    acceptBroadcast(input) {
      preview.write(input.mode === 'submit' ? terminalSubmitBytes(input.text) : input.text);
    },
    capture() {
      try { return preview.render(false); } catch { return ''; }
    },
    get isAlive() { return preview.isAlive; },
    on: obs.on,
    dispose() {
      try { preview.stop(); } catch { /* ignore */ }
    },
  };
  return pane;
}

// ─── Markdown content ─────────────────────────────────────────────

export function createMarkdownPaneContent(
  spec: Extract<PaneContentSpec, { kind: 'markdown' }>,
  _deps: PaneFactoryDeps,
): PaneContent {
  const id = mintPaneId();
  const obs = createObserver();
  let text = spec.text;
  let alive = true;

  const pane: PaneContent = {
    id,
    kind: 'markdown',
    title: spec.title ?? 'markdown',
    focusPolicy: 'interactive',
    start() { /* no-op */ },
    stop() { alive = false; },
    render(ctx) {
      return layoutMarkdown(text, ctx.cols, ctx.rows);
    },
    onKey() { return { type: 'none' }; },     // static content ignores keys
    write(bytes) { text = bytes; obs.emit('update'); },
    acceptBroadcast(input) {
      text = input.text;
      obs.emit('update');
    },
    capture() { return text; },
    get isAlive() { return alive; },
    on: obs.on,
    dispose() { alive = false; },
  };
  return pane;
}

// ─── LLM chat content ─────────────────────────────────────────────

export function createLLMChatPaneContent(
  spec: Extract<PaneContentSpec, { kind: 'llm-chat' }>,
  deps: PaneFactoryDeps,
): PaneContent {
  const id = mintPaneId();
  const obs = createObserver();
  const messages: Array<{ role: 'system'|'user'|'assistant'; content: string }> = [];
  if (spec.systemPrompt) messages.push({ role: 'system', content: spec.systemPrompt });
  if (spec.seed) messages.push({ role: 'user', content: spec.seed });
  let composing = '';
  let alive = true;
  let streaming = false;

  async function submit(userText: string): Promise<void> {
    if (streaming) return;
    messages.push({ role: 'user', content: userText });
    obs.emit('update');
    if (!deps.llmChatBackend) {
      messages.push({ role: 'assistant', content: `[llm backend not wired — pane uses provider ${spec.provider}]` });
      obs.emit('update');
      return;
    }
    streaming = true;
    const assistantBuf: string[] = [];
    try {
      for await (const chunk of deps.llmChatBackend({
        provider: spec.provider,
        model: spec.model,
        messages: messages.slice(),
      })) {
        assistantBuf.push(chunk);
        if (messages[messages.length - 1]?.role !== 'assistant') {
          messages.push({ role: 'assistant', content: '' });
        }
        messages[messages.length - 1]!.content = assistantBuf.join('');
        obs.emit('output', chunk);
        obs.emit('update');
      }
    } catch (err) {
      messages.push({ role: 'assistant', content: `[error: ${err instanceof Error ? err.message : String(err)}]` });
      obs.emit('update');
    } finally {
      streaming = false;
    }
  }

  const pane: PaneContent = {
    id,
    kind: 'llm-chat',
    title: spec.title ?? `${spec.provider}${spec.model ? `:${spec.model}` : ''}`,
    focusPolicy: 'interactive',
    start() { /* nothing to start; first write triggers submit */ },
    stop() { alive = false; },
    render(ctx) {
      return renderChat(pane.title, messages, composing, ctx);
    },
    onKey(ev) {
      const name = (ev.name ?? '').toLowerCase();
      if (name === 'enter' || name === 'return') {
        const toSend = composing;
        composing = '';
        obs.emit('update');
        void submit(toSend);
        return { type: 'refresh' };
      }
      if (name === 'backspace') {
        composing = composing.slice(0, -1);
        obs.emit('update');
        return { type: 'refresh' };
      }
      if (!ev.ctrl && !ev.alt && (ev.name?.length ?? 0) === 1) {
        composing += ev.shift ? (ev.name ?? '').toUpperCase() : (ev.name ?? '');
        obs.emit('update');
        return { type: 'refresh' };
      }
      return { type: 'none' };
    },
    write(bytes) {
      // Treat raw write as "submit this exact string" — broadcast
      // path uses this.
      void submit(bytes.trimEnd());
    },
    acceptBroadcast(input) {
      if (input.mode === 'replace') {
        composing = input.text;
        obs.emit('update');
        return;
      }
      void submit(input.text.trimEnd());
    },
    capture() {
      return messages.map(m => `[${m.role}] ${m.content}`).join('\n\n');
    },
    get isAlive() { return alive; },
    on: obs.on,
    dispose() { alive = false; },
  };
  return pane;
}

// ─── Scratch content ──────────────────────────────────────────────

export function createScratchPaneContent(
  spec: Extract<PaneContentSpec, { kind: 'scratch' }>,
  _deps: PaneFactoryDeps,
): PaneContent {
  const id = mintPaneId();
  const obs = createObserver();
  let buf = spec.initialText ?? '';
  let alive = true;

  return {
    id,
    kind: 'scratch',
    title: spec.title ?? 'scratch',
    focusPolicy: 'interactive',
    start() { /* no-op */ },
    stop() { alive = false; },
    render(ctx) { return layoutText(buf, ctx.cols, ctx.rows); },
    onKey() { return { type: 'none' }; },
    write(bytes) { buf = bytes; obs.emit('update'); },
    acceptBroadcast(input) { buf = input.text; obs.emit('update'); },
    capture() { return buf; },
    get isAlive() { return alive; },
    on: obs.on,
    dispose() { alive = false; },
  };
}

// ─── Factory dispatch ─────────────────────────────────────────────

type FactoryFn = (spec: PaneContentSpec, deps: PaneFactoryDeps) => PaneContent;
const registry: Map<PaneContentKind, FactoryFn> = new Map([
  ['terminal', createTerminalPaneContent as unknown as FactoryFn],
  ['terminal-slot', ((spec: PaneContentSpec) => {
    if (spec.kind !== 'terminal-slot') throw new Error('expected terminal-slot spec');
    return createTerminalSlotContent(
      { kind: 'terminal-slot', terminalId: spec.terminalId, title: spec.title },
      { resolve: (id) => getTerminalMatrix().get(id) },
    );
  }) as FactoryFn],
  ['markdown', createMarkdownPaneContent as unknown as FactoryFn],
  ['llm-chat', createLLMChatPaneContent as unknown as FactoryFn],
  ['scratch',  createScratchPaneContent as unknown as FactoryFn],
  ['pty-tail', createPtyTailPaneContent as unknown as FactoryFn],
]);

export function registerPaneContentKind(kind: PaneContentKind, factory: FactoryFn): void {
  registry.set(kind, factory);
}

export function createPaneContent(spec: PaneContentSpec, deps: PaneFactoryDeps = {}): PaneContent {
  const factory = registry.get(spec.kind);
  if (!factory) throw new Error(`unknown pane content kind: ${spec.kind}`);
  return factory(spec, deps);
}

// ─── Shared rendering helpers ─────────────────────────────────────

function layoutText(text: string, cols: number, rows: number): string {
  const raw = text.split('\n');
  const lines: string[] = [];
  for (const src of raw) {
    // Soft-wrap to cols (plain text, no ANSI handling for scratch/md
    // content that comes in as plain strings).
    let rest = src;
    if (rest.length === 0) { lines.push(''); continue; }
    while (rest.length > cols) {
      lines.push(rest.slice(0, cols));
      rest = rest.slice(cols);
    }
    lines.push(rest);
  }
  // Pad / truncate to rows.
  if (lines.length > rows) return lines.slice(0, rows).join('\n');
  while (lines.length < rows) lines.push('');
  return lines.join('\n');
}

function terminalSubmitBytes(text: string): string {
  return text.endsWith('\n') || text.endsWith('\r') ? text : `${text}\r`;
}

function layoutMarkdown(text: string, cols: number, rows: number): string {
  const blocks = parseMarkdownBlocks(text);
  const renderedBlocks = renderParsedMarkdownBlocks(
    blocks,
    'truecolor',
    { width: Math.max(20, cols), keepAttrsInMono: true },
  );
  const lines = wrapAnsiByWidth('', {
    cols,
    mode: cols < 60 ? 'block-aware' : 'soft',
    tablePolicy: 'overflow',
    segments: renderedBlocks,
  });
  if (lines.length > rows) return lines.slice(0, rows).join('\n');
  while (lines.length < rows) lines.push('');
  return lines.join('\n');
}

function renderChat(
  title: string,
  messages: Array<{ role: string; content: string }>,
  composing: string,
  ctx: PaneRenderCtx,
): string {
  const lines: string[] = [];
  lines.push(C.accent(title));
  lines.push(C.muted('─'.repeat(Math.min(ctx.cols, 40))));
  // Render tail-most messages first so the bottom row is most recent;
  // reverse back for display.
  const rendered: string[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    const label = m.role === 'user' ? C.sky('you') : m.role === 'assistant' ? C.peach('ai') : C.muted('sys');
    const header = `${label}: `;
    const body = m.content.split('\n');
    for (const b of body) rendered.push(header + b);
    rendered.push('');
    if (rendered.length >= ctx.rows - 4) break;
  }
  rendered.reverse();
  const budget = Math.max(0, ctx.rows - 4);
  for (const r of rendered.slice(-budget)) lines.push(r);
  while (lines.length < ctx.rows - 1) lines.push('');
  lines.push(C.muted('› ') + composing + (ctx.focused ? C.accent('▋') : ''));
  return lines.slice(0, ctx.rows).join('\n');
}

// Keep visibleWidth/stripAnsi available for future rendering needs
// even though the simple layoutText doesn't use them yet — importing
// but not using would yield dead-code lint hits in consumers that
// re-export. Re-export for internal consumers.
export { visibleWidth, stripAnsi, ansi };
