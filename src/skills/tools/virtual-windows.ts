// Native tools for virtual-windows — VW-P9.
//
// Exposes window + pane control to skill-runner so LLMs can:
//
//   • list / create / switch / close windows
//   • list / split / focus / close / capture / inject panes
//   • broadcast bytes to multiple panes at once
//   • subscribe to event streams (observability)
//
// Registry wiring is deferred: the dashboard calls
// `initVirtualWindowTools(registry, eventBus, addressBook, paneDeps)`
// at startup; the dispatchers then use those singletons. Tests pass
// overrides via the deps argument.

import type { LLMToolSpec } from '../../llm.js';
import type { WindowRegistry } from '../../virtual-windows/window-registry.js';
import type { VWEventBus } from '../../virtual-windows/event-bus.js';
import type { AddressBook, WindowId } from '../../virtual-windows/addressing.js';
import type { PaneContentSpec, PaneFactoryDeps } from '../../virtual-windows/pane-content.js';
import type { Direction } from '../../virtual-windows/layout-tree.js';
import { capturePane } from '../../virtual-windows/pane-capture.js';
import { createPaneContent } from '../../virtual-windows/pane-content.js';

interface VWToolDeps {
  registry?: WindowRegistry;
  eventBus?: VWEventBus;
  addressBook?: AddressBook;
  paneDeps?: PaneFactoryDeps;
  /** T1-P2 — called before PaneInject writes. Return false to veto. */
  injectApprover?: (req: {
    paneAddr: string;
    paneKind: string;
    previewBytes: string;
    totalBytes: number;
  }) => Promise<boolean>;
  /** T1-P2 — called before BroadcastPanes fans out. */
  broadcastApprover?: (req: {
    targets: string[];
    previewBytes: string;
    totalBytes: number;
  }) => Promise<boolean>;
}

let _registry: WindowRegistry | null = null;
let _bus: VWEventBus | null = null;
let _book: AddressBook | null = null;
let _paneDeps: PaneFactoryDeps = {};
let _injectApprover: VWToolDeps['injectApprover'] = undefined;
let _broadcastApprover: VWToolDeps['broadcastApprover'] = undefined;

export function initVirtualWindowTools(
  registry: WindowRegistry,
  bus: VWEventBus,
  book: AddressBook,
  paneDeps: PaneFactoryDeps = {},
  approvers: {
    injectApprover?: VWToolDeps['injectApprover'];
    broadcastApprover?: VWToolDeps['broadcastApprover'];
  } = {},
): void {
  _registry = registry;
  _bus = bus;
  _book = book;
  _paneDeps = paneDeps;
  _injectApprover = approvers.injectApprover;
  _broadcastApprover = approvers.broadcastApprover;
}

export function _resetVirtualWindowToolsForTesting(): void {
  _registry = null; _bus = null; _book = null; _paneDeps = {};
  _injectApprover = undefined; _broadcastApprover = undefined;
}

function need<T>(v: T | null, name: string): T {
  if (v === null) throw new Error(`virtual-window tools not initialized — ${name} missing`);
  return v;
}

function regOf(d: VWToolDeps): WindowRegistry { return d.registry ?? need(_registry, 'registry'); }
function busOf(d: VWToolDeps): VWEventBus { return d.eventBus ?? need(_bus, 'eventBus'); }
function bookOf(d: VWToolDeps): AddressBook { return d.addressBook ?? need(_book, 'addressBook'); }
function paneDepsOf(d: VWToolDeps): PaneFactoryDeps { return d.paneDeps ?? _paneDeps; }
function injectApproverOf(d: VWToolDeps): VWToolDeps['injectApprover'] | undefined {
  return d.injectApprover ?? _injectApprover;
}
function broadcastApproverOf(d: VWToolDeps): VWToolDeps['broadcastApprover'] | undefined {
  return d.broadcastApprover ?? _broadcastApprover;
}

// ─── Tool spec builders ───────────────────────────────────────────

export function buildWindowListTool(): LLMToolSpec {
  return {
    name: 'WindowList',
    description: 'List virtual windows with id, title, foreground/background state, and pane count.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  };
}

export function buildWindowCreateTool(): LLMToolSpec {
  return {
    name: 'WindowCreate',
    description: 'Create a new virtual window. The initial pane content is a factory spec: terminal/markdown/scratch/llm-chat.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: {
          type: 'object',
          description: 'Pane content spec — {kind:"terminal",cmd,cwd,termName} | {kind:"markdown",text,title} | {kind:"scratch",title} | {kind:"llm-chat",provider,model,systemPrompt}',
        },
        foreground: { type: 'boolean', description: 'Default true. Pass false to keep the new window in bg.' },
      },
      required: ['title', 'content'],
      additionalProperties: false,
    },
  };
}

export function buildWindowSwitchTool(): LLMToolSpec {
  return {
    name: 'WindowSwitch',
    description: 'Bring a virtual window to foreground by id.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'integer' } },
      required: ['id'],
      additionalProperties: false,
    },
  };
}

export function buildWindowCloseTool(): LLMToolSpec {
  return {
    name: 'WindowClose',
    description: 'Close a virtual window and all its panes. Irreversible.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'integer' } },
      required: ['id'],
      additionalProperties: false,
    },
  };
}

export function buildPaneListTool(): LLMToolSpec {
  return {
    name: 'PaneList',
    description: 'List panes of a window (or all windows).',
    parameters: {
      type: 'object',
      properties: { window_id: { type: 'integer' } },
      additionalProperties: false,
    },
  };
}

export function buildPaneSplitTool(): LLMToolSpec {
  return {
    name: 'PaneSplit',
    description: 'Split a pane horizontally ("h" = side-by-side) or vertically ("v" = stacked). New pane content uses the same spec shape as WindowCreate.',
    parameters: {
      type: 'object',
      properties: {
        pane_addr: { type: 'string', description: 'Address of pane to split (pane:<id> or win:N/pane:<id>).' },
        axis: { type: 'string', enum: ['h', 'v'] },
        content: { type: 'object' },
        ratio: { type: 'number', description: '0..1 size of existing pane after split. Default 0.5.' },
      },
      required: ['pane_addr', 'axis', 'content'],
      additionalProperties: false,
    },
  };
}

export function buildPaneFocusTool(): LLMToolSpec {
  return {
    name: 'PaneFocus',
    description: 'Focus a pane within its window. Optional direction moves focus relatively.',
    parameters: {
      type: 'object',
      properties: {
        pane_addr: { type: 'string' },
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
      },
      additionalProperties: false,
    },
  };
}

export function buildPaneCloseTool(): LLMToolSpec {
  return {
    name: 'PaneClose',
    description: 'Close a pane. The window auto-collapses.',
    parameters: {
      type: 'object',
      properties: { pane_addr: { type: 'string' } },
      required: ['pane_addr'],
      additionalProperties: false,
    },
  };
}

export function buildPaneCaptureTool(): LLMToolSpec {
  return {
    name: 'PaneCapture',
    description:
      'Snapshot a pane. Modes: auto (text with OCR fallback), text (ANSI stripped), ocr (force). '
      + 'Address via `target: {kind:"pane", ref:{windowId, paneId}}` (preferred · same SurfaceAddress '
      + 'shape used by Screenshot / DescribeSurface / InspectPane) or legacy `pane_addr: string` '
      + '(`"pane:<id>"` · `"win:N/pane:<id>"`). Exactly one is required.',
    parameters: {
      type: 'object',
      properties: {
        target: {
          type: 'object',
          description: 'SurfaceAddress · kind must be "pane". Same shape used by Screenshot / DescribeSurface.',
          properties: {
            kind: { type: 'string', enum: ['pane'] },
            ref: {
              type: 'object',
              properties: {
                windowId: { type: 'string' },
                paneId: { type: 'string' },
                runnerLabel: { type: 'string' },
              },
            },
          },
        },
        pane_addr: { type: 'string', description: 'Legacy string address — use `target` for new callers.' },
        mode: { type: 'string', enum: ['text', 'ocr', 'auto'] },
        max_bytes: { type: 'integer' },
      },
      // B-11-α — neither `target` nor `pane_addr` is required at the
      // schema level; the dispatcher rejects the call with an explicit
      // error when both are missing so legacy callers that always pass
      // `pane_addr` keep the same error shape.
      additionalProperties: false,
    },
  };
}

export function buildPaneInjectTool(): LLMToolSpec {
  return {
    name: 'PaneInject',
    description:
      'Write bytes or a named key to a pane (PTY stdin / chat submit / scratch replace). '
      + 'Address via `target: {kind:"pane", ref:{windowId, paneId}}` (preferred · same shape '
      + 'as PaneCapture / Screenshot / DescribeSurface) or legacy `pane_addr: string`. '
      + 'Mutating; requires approval.',
    parameters: {
      type: 'object',
      properties: {
        target: {
          type: 'object',
          description: 'SurfaceAddress · kind must be "pane".',
          properties: {
            kind: { type: 'string', enum: ['pane'] },
            ref: {
              type: 'object',
              properties: {
                windowId: { type: 'string' },
                paneId: { type: 'string' },
                runnerLabel: { type: 'string' },
              },
            },
          },
        },
        pane_addr: { type: 'string', description: 'Legacy string address — use `target` for new callers.' },
        bytes: { type: 'string' },
      },
      // B-12-α — target / pane_addr 둘 중 하나는 필수지만 schema level
      // required 에서는 제외 · dispatcher 에서 "둘 다 없음" 을 명시 에러로.
      required: ['bytes'],
      additionalProperties: false,
    },
  };
}

export function buildBroadcastTool(): LLMToolSpec {
  return {
    name: 'BroadcastPanes',
    description:
      'Write the same bytes to multiple panes at once (e.g. 4-pane LLM benchmark). '
      + 'Each element of `targets` may be a legacy string (`"pane:<id>"`) or a '
      + '`{kind:"pane", ref:{windowId, paneId}}` SurfaceAddress — mixed arrays supported.',
    parameters: {
      type: 'object',
      properties: {
        targets: {
          type: 'array',
          items: {
            oneOf: [
              { type: 'string', description: 'Legacy pane address.' },
              {
                type: 'object',
                description: 'SurfaceAddress · kind must be "pane".',
                properties: {
                  kind: { type: 'string', enum: ['pane'] },
                  ref: {
                    type: 'object',
                    properties: {
                      windowId: { type: 'string' },
                      paneId: { type: 'string' },
                      runnerLabel: { type: 'string' },
                    },
                  },
                },
              },
            ],
          },
        },
        bytes: { type: 'string' },
      },
      required: ['targets', 'bytes'],
      additionalProperties: false,
    },
  };
}

export function buildSubscribeTool(): LLMToolSpec {
  return {
    name: 'VWSubscribe',
    description: 'Register a temporary event subscription. Returns subscription_id; call VWCollect later to drain.',
    parameters: {
      type: 'object',
      properties: {
        addr_prefix: { type: 'string' },
        types: { type: 'array', items: { type: 'string' } },
      },
      additionalProperties: false,
    },
  };
}

// ─── Dispatchers ──────────────────────────────────────────────────

export async function dispatchWindowList(_raw: Record<string, unknown>, deps: VWToolDeps = {}): Promise<{ output: string }> {
  const registry = regOf(deps);
  const windows = registry.list();
  if (windows.length === 0) return { output: 'WindowList (0 windows)' };
  const current = registry.current();
  const lines = [`WindowList (${windows.length} windows)`];
  for (const w of windows) {
    const fg = w === current ? 'fg' : 'bg';
    lines.push(`  win:${w.id} state=${fg} title="${w.title}" panes=${w.listPanes().length}`);
  }
  return { output: lines.join('\n') };
}

export async function dispatchWindowCreate(raw: Record<string, unknown>, deps: VWToolDeps = {}): Promise<{ output: string }> {
  const registry = regOf(deps);
  const title = String(raw.title ?? 'untitled');
  const content = raw.content as PaneContentSpec | undefined;
  if (!content) throw new Error(`'content' is required`);
  const foreground = raw.foreground !== false;
  const window = registry.spawn({
    title,
    initialContent: content,
    foreground,
  });
  return { output: `WindowCreate window_id=${window.id} title="${window.title}" pane:${window.focused}` };
}

export async function dispatchWindowSwitch(raw: Record<string, unknown>, deps: VWToolDeps = {}): Promise<{ output: string }> {
  const registry = regOf(deps);
  const id = Number(raw.id);
  if (!Number.isInteger(id)) throw new Error(`'id' must be an integer`);
  const ok = registry.switchTo(id as WindowId);
  if (!ok) throw new Error(`no window with id ${id}`);
  return { output: `WindowSwitch → win:${id}` };
}

export async function dispatchWindowClose(raw: Record<string, unknown>, deps: VWToolDeps = {}): Promise<{ output: string }> {
  const registry = regOf(deps);
  const id = Number(raw.id);
  if (!Number.isInteger(id)) throw new Error(`'id' must be an integer`);
  const ok = registry.close(id as WindowId);
  if (!ok) throw new Error(`no window with id ${id}`);
  return { output: `WindowClose win:${id}` };
}

export async function dispatchPaneList(raw: Record<string, unknown>, deps: VWToolDeps = {}): Promise<{ output: string }> {
  const registry = regOf(deps);
  const windowId = raw.window_id !== undefined ? Number(raw.window_id) : null;
  const windows = windowId === null ? registry.list() : [registry.get(windowId as WindowId)!].filter(Boolean);
  if (windows.length === 0) return { output: 'PaneList (no matching windows)' };
  const lines: string[] = [];
  for (const w of windows) {
    lines.push(`win:${w.id} title="${w.title}"`);
    for (const { id, content } of w.listPanes()) {
      const focused = w.focused === id ? ' (focused)' : '';
      lines.push(`  pane:${id} kind=${content.kind} title="${content.title}"${focused}`);
    }
  }
  return { output: lines.join('\n') };
}

export async function dispatchPaneSplit(raw: Record<string, unknown>, deps: VWToolDeps = {}): Promise<{ output: string }> {
  const registry = regOf(deps);
  const book = bookOf(deps);
  const paneDeps = paneDepsOf(deps);
  const addr = String(raw.pane_addr ?? '');
  const axis = raw.axis === 'v' ? 'v' : 'h';
  const contentSpec = raw.content as PaneContentSpec | undefined;
  const ratio = typeof raw.ratio === 'number' ? raw.ratio : 0.5;
  if (!addr) throw new Error(`'pane_addr' required`);
  if (!contentSpec) throw new Error(`'content' required`);
  const pane = book.resolvePane(addr);
  if (!pane) throw new Error(`pane not found: ${addr}`);
  const window = registry.get(pane.windowId);
  if (!window) throw new Error(`window not found for pane ${addr}`);
  const newContent = createPaneContent(contentSpec, paneDeps);
  const newPaneId = window.splitPaneAt(pane.id, axis, newContent, ratio);
  return { output: `PaneSplit pane:${newPaneId} in win:${window.id}` };
}

export async function dispatchPaneFocus(raw: Record<string, unknown>, deps: VWToolDeps = {}): Promise<{ output: string }> {
  const registry = regOf(deps);
  const book = bookOf(deps);
  const addr = raw.pane_addr ? String(raw.pane_addr) : undefined;
  const direction = raw.direction as Direction | undefined;
  if (addr) {
    const pane = book.resolvePane(addr);
    if (!pane) throw new Error(`pane not found: ${addr}`);
    const window = registry.get(pane.windowId);
    if (!window) throw new Error(`window not found`);
    if (registry.current() !== window) registry.switchTo(window.id);
    const ok = window.setFocus(pane.id);
    return { output: `PaneFocus pane:${pane.id} ok=${ok}` };
  }
  if (direction) {
    const window = registry.current();
    if (!window) throw new Error(`no foreground window`);
    const ok = window.focusDirection(direction);
    return { output: `PaneFocus dir=${direction} ok=${ok} focused=pane:${window.focused}` };
  }
  throw new Error(`provide 'pane_addr' or 'direction'`);
}

export async function dispatchPaneClose(raw: Record<string, unknown>, deps: VWToolDeps = {}): Promise<{ output: string }> {
  const registry = regOf(deps);
  const book = bookOf(deps);
  const addr = String(raw.pane_addr ?? '');
  const pane = book.resolvePane(addr);
  if (!pane) throw new Error(`pane not found: ${addr}`);
  const window = registry.get(pane.windowId);
  if (!window) throw new Error(`window not found`);
  const ok = window.closePaneAt(pane.id);
  return { output: `PaneClose pane:${pane.id} ok=${ok}` };
}

export async function dispatchPaneCapture(raw: Record<string, unknown>, deps: VWToolDeps = {}): Promise<{ output: string }> {
  const book = bookOf(deps);
  const addr = resolvePaneAddrFromRaw(raw);
  if (!addr) throw new Error(`PaneCapture: provide 'target' or 'pane_addr'`);
  const mode = (raw.mode as 'text' | 'ocr' | 'auto' | undefined) ?? 'auto';
  const maxBytes = typeof raw.max_bytes === 'number' ? raw.max_bytes : undefined;
  const r = await capturePane(book, addr, { mode, maxBytes });
  if (!r) throw new Error(`pane not found: ${addr}`);
  return { output: `PaneCapture ${r.addr} kind=${r.kind} mode=${r.mode} ocr=${r.ocrBackendUsed}\n${r.body}` };
}

/** B-11-α · accept structured `target: SurfaceAddress` (kind='pane') or
 *  legacy `pane_addr: string`. Returns the string form AddressBook
 *  consumes (`pane:<id>`). Prefers the legacy string when both are
 *  present so explicit caller intent wins — unlikely but deterministic. */
function resolvePaneAddrFromRaw(raw: Record<string, unknown>): string | null {
  if (typeof raw.pane_addr === 'string' && raw.pane_addr.length > 0) {
    return raw.pane_addr;
  }
  return coerceBroadcastTarget(raw.target);
}

/** B-12-α · parse one element of BroadcastPanes `targets` array (or the
 *  `target` field of PaneInject / PaneCapture). Accepts legacy string
 *  form or `{kind:'pane', ref:{paneId}}` SurfaceAddress. Returns null
 *  for any other shape so callers can surface an explicit error. */
function coerceBroadcastTarget(raw: unknown): string | null {
  if (typeof raw === 'string' && raw.length > 0) return raw;
  if (raw && typeof raw === 'object') {
    const t = raw as Record<string, unknown>;
    if (t.kind === 'pane' && t.ref && typeof t.ref === 'object') {
      const r = t.ref as Record<string, unknown>;
      if (typeof r.paneId === 'string' && r.paneId.length > 0) {
        return `pane:${r.paneId}`;
      }
    }
  }
  return null;
}

export async function dispatchPaneInject(raw: Record<string, unknown>, deps: VWToolDeps = {}): Promise<{ output: string }> {
  const registry = regOf(deps);
  const book = bookOf(deps);
  const addr = resolvePaneAddrFromRaw(raw);
  if (!addr) throw new Error(`PaneInject: provide 'target' or 'pane_addr'`);
  const bytes = String(raw.bytes ?? '');
  const pane = book.resolvePane(addr);
  if (!pane) throw new Error(`pane not found: ${addr}`);
  const window = registry.get(pane.windowId);
  if (!window) throw new Error(`window not found`);
  const content = window.getPane(pane.id);
  if (!content) throw new Error(`pane content missing`);
  // T1-P2 — approval gate. Fail-closed when no approver is wired so
  // headless paths (tests, detached runs) can't sneak-inject.
  const approver = injectApproverOf(deps);
  if (!approver) {
    throw new Error(
      'PaneInject refused — no approver is wired. This tool requires ' +
      'explicit user approval; the dashboard provides the approver at runtime.',
    );
  }
  const previewBytes = bytes.length > 60 ? bytes.slice(0, 60) + '…' : bytes;
  const approved = await approver({
    paneAddr: `pane:${pane.id}`,
    paneKind: content.kind,
    previewBytes,
    totalBytes: bytes.length,
  });
  if (!approved) throw new Error('PaneInject rejected by user');
  try { content.write(bytes); }
  catch (err) { throw new Error(`inject failed: ${err instanceof Error ? err.message : String(err)}`); }
  return { output: `PaneInject pane:${pane.id} bytes=${bytes.length}` };
}

export async function dispatchBroadcast(raw: Record<string, unknown>, deps: VWToolDeps = {}): Promise<{ output: string }> {
  const bus = busOf(deps);
  const rawTargets = Array.isArray(raw.targets) ? raw.targets : [];
  const targets: string[] = [];
  const invalid: unknown[] = [];
  for (const t of rawTargets) {
    const s = coerceBroadcastTarget(t);
    if (s) targets.push(s);
    else invalid.push(t);
  }
  if (invalid.length > 0) {
    throw new Error(
      `BroadcastPanes: invalid target(s) — expected string or {kind:"pane", ref:{paneId}}. Count=${invalid.length}`,
    );
  }
  const bytes = String(raw.bytes ?? '');
  if (targets.length === 0) throw new Error(`'targets' array required`);
  // T1-P2 — approval gate. Fail-closed identical to PaneInject.
  const approver = broadcastApproverOf(deps);
  if (!approver) {
    throw new Error(
      'BroadcastPanes refused — no approver is wired. This tool requires ' +
      'explicit user approval; the dashboard provides the approver at runtime.',
    );
  }
  const previewBytes = bytes.length > 60 ? bytes.slice(0, 60) + '…' : bytes;
  const approved = await approver({
    targets,
    previewBytes,
    totalBytes: bytes.length,
  });
  if (!approved) throw new Error('BroadcastPanes rejected by user');
  const r = bus.broadcast(targets, bytes);
  const summary = `BroadcastPanes sent=${r.sent}/${r.total}`;
  const failure = r.failed.length
    ? `\n  failed: ${r.failed.map(f => `${f.addr}(${f.reason})`).join(', ')}`
    : '';
  return { output: summary + failure };
}

// ─── Subscribe (session-scope buffer) ─────────────────────────────

interface Subscription {
  id: string;
  unsubscribe: () => void;
  buffer: unknown[];
}
const subscriptions = new Map<string, Subscription>();

export async function dispatchSubscribe(raw: Record<string, unknown>, deps: VWToolDeps = {}): Promise<{ output: string }> {
  const bus = busOf(deps);
  const id = `sub:${Math.random().toString(36).slice(2, 9)}`;
  const buffer: unknown[] = [];
  const unsub = bus.subscribe({
    addrPrefix: raw.addr_prefix ? String(raw.addr_prefix) : undefined,
    types: Array.isArray(raw.types) ? raw.types as VWEventInputType[] : undefined,
  }, (ev) => {
    if (buffer.length < 256) buffer.push(ev);
  });
  subscriptions.set(id, { id, unsubscribe: unsub, buffer });
  return { output: `VWSubscribe subscription_id=${id}` };
}
type VWEventInputType = 'pane:output' | 'pane:input' | 'pane:focus' | 'pane:create' | 'pane:close' | 'window:create' | 'window:close' | 'window:switch' | 'broadcast' | 'attention';

export function buildVWCollectTool(): LLMToolSpec {
  return {
    name: 'VWCollect',
    description: 'Drain events buffered by a VWSubscribe subscription. Returns up to 256 events.',
    parameters: {
      type: 'object',
      properties: { subscription_id: { type: 'string' } },
      required: ['subscription_id'],
      additionalProperties: false,
    },
  };
}

export async function dispatchVWCollect(raw: Record<string, unknown>, _deps: VWToolDeps = {}): Promise<{ output: string }> {
  const id = String(raw.subscription_id ?? '');
  const sub = subscriptions.get(id);
  if (!sub) throw new Error(`unknown subscription_id ${id}`);
  const drained = sub.buffer.splice(0);
  return { output: `VWCollect id=${id} events=${drained.length}\n${drained.map(e => JSON.stringify(e)).join('\n')}` };
}

export function buildVWUnsubscribeTool(): LLMToolSpec {
  return {
    name: 'VWUnsubscribe',
    description: 'Cancel a VWSubscribe subscription.',
    parameters: {
      type: 'object',
      properties: { subscription_id: { type: 'string' } },
      required: ['subscription_id'],
      additionalProperties: false,
    },
  };
}

export async function dispatchVWUnsubscribe(raw: Record<string, unknown>, _deps: VWToolDeps = {}): Promise<{ output: string }> {
  const id = String(raw.subscription_id ?? '');
  const sub = subscriptions.get(id);
  if (!sub) throw new Error(`unknown subscription_id ${id}`);
  sub.unsubscribe();
  subscriptions.delete(id);
  return { output: `VWUnsubscribe ${id}` };
}
