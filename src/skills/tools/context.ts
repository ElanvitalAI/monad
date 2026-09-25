// ── Context pull tools — Phase C of PLAN-llm-active-context-and-control ──
//
// A family of read-only LLM tools that replace the dropped auto-inject
// snapshot. Each tool answers ONE question ("what windows are open?",
// "what did pty:xyz last output?"), so the LLM can chain them: a
// broad listing first, then drill into the single element it cares
// about. Token cost scales with interest instead of turn count.
//
// All outputs intentionally return JSON-friendly shapes + a short
// `output` string for the LLM's preview pane.
//
// Related:
//   • src/element-registry/         — single source of truth for addresses
//   • src/tool-runtime/context-runtime.ts — registry registration
//   • 내부 문서 `PLAN-llm-active-context-and-control` §4 Phase C

import type { LLMToolSpec } from '../../llm.js';
import {
  getGlobalElementRegistry,
  getGlobalElementStateStore,
  getGlobalElementEventBus,
  type ElementKind,
  type ElementEventType,
} from '../../element-registry/index.js';
import { listPty, getPty } from '../../pty-shell/registry.js';
import { nativeToolCatalog } from '../../native-tool-catalog.js';
import { NATIVE_TOOL_HOSTS } from '../../tool-surface.js';
import { getSessionCwd } from '../../session/working-dir.js';

// ── Helpers ────────────────────────────────────────────────────────

function workspaceBlob(deps?: ContextDeps): {
  cwd: string;
  platform: NodeJS.Platform;
  remoteHost?: string;
  sandboxAvailable?: boolean;
} {
  return {
    // WD6 — workspace blob reports the active session working
    // directory so LLM-visible context tracks Ctrl+W promotions.
    cwd: deps?.cwd ?? getSessionCwd(),
    platform: process.platform,
    remoteHost: deps?.remoteHost,
    sandboxAvailable: process.platform === 'darwin' || process.platform === 'linux',
  };
}

/** Optional DI so dashboard can inject cwd, remoteHost, VW hooks,
 *  terminal-session list, scheduler store. Defaults pull from the
 *  ambient singletons so a skill-only LLM still gets useful output. */
export interface ContextDeps {
  cwd?: string;
  remoteHost?: string;
  getWindowRegistry?: () => {
    list(): Array<{
      id: number;
      title: string;
      listPanes(): Array<{ id: string; content: { kind: string; title?: string } }>;
      focused: string | null;
    }>;
    current?: () => { id: number } | null;
  } | null;
  getTerminalSessions?: () => Array<{ id: string; title: string; state: string }>;
  /** Capture pane text for `context.pane.detail`. Empty when absent. */
  capturePane?: (paneId: string, maxBytes?: number) => string | undefined;
}

// ── Tool specs ─────────────────────────────────────────────────────

export function buildContextTools(): LLMToolSpec[] {
  return [
    {
      name: 'ContextWorkspace',
      description:
        'Return workspace basics: cwd, platform, optional remote host, and whether a sandbox is available. Cheap — call once at turn start.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'ContextWindowsList',
      description:
        'List virtual windows: id, title, foreground flag, pane count. Use for broad layout survey; follow up with ContextWindowDetail for one window.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'ContextWindowDetail',
      description:
        'Detail for one virtual window: pane ids + kinds + rects + focused flag. Input `addr` accepts either "win:3" or "3".',
      parameters: {
        type: 'object',
        properties: { addr: { type: 'string' } },
        required: ['addr'],
        additionalProperties: false,
      },
    },
    {
      name: 'ContextPaneDetail',
      description:
        'Detail for one pane: kind, title, which window, optional tail of its rendered text (set `captureTail:true`).',
      parameters: {
        type: 'object',
        properties: {
          addr: { type: 'string' },
          captureTail: { type: 'boolean' },
          maxBytes: { type: 'number' },
        },
        required: ['addr'],
        additionalProperties: false,
      },
    },
    {
      name: 'ContextPtysList',
      description:
        'List live PTY shells: id, cmd, status (running|exited), ageSec. Use for "what background shells exist?".',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'ContextPtyDetail',
      description:
        'One PTY: full cmd, workdir, exitCode+signal (if any), optional tail of captured output.',
      parameters: {
        type: 'object',
        properties: {
          addr: { type: 'string' },
          tailBytes: { type: 'number' },
        },
        required: ['addr'],
        additionalProperties: false,
      },
    },
    {
      name: 'ContextSessionsList',
      description:
        'List terminal-modal sessions (coding agents + shells): id, title, state (foreground|background|exited).',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    // Surface-unification v2.2 V2.2-5 (2026-05-11) — `ContextJobsList` retired
    // (scheduler view폐기). Workflows take that role under `/workflows`; LLMs
    // call workflow-runtime listings directly when they need a scheduled-work
    // snapshot.
    {
      name: 'ContextWidgetsList',
      description: 'List currently-mounted widgets by id (tied to the active plugin, if any).',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'ContextPluginsList',
      description: 'List active plugins by id.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'ContextToolsList',
      description:
        'List native tools in the catalog with host + safety flags. Helpful when you want to know what you can call before calling it.',
      parameters: {
        type: 'object',
        properties: {
          host: {
            type: 'string',
            enum: [...NATIVE_TOOL_HOSTS],
          },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'ContextEventsTail',
      description:
        'Read the most recent element events (create/update/delete/output/exit/...). Filter by kinds, types, addr, sinceTs. Use for "did anything happen since my last check?".',
      parameters: {
        type: 'object',
        properties: {
          sinceTs: { type: 'number' },
          kinds: { type: 'array', items: { type: 'string' } },
          types: { type: 'array', items: { type: 'string' } },
          addr: { type: 'string' },
          limit: { type: 'number' },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'ContextBootstrap',
      description:
        'One-shot context warmup: returns workspace + windows.list + ptys.list + sessions.list + tools.list together. Call once at turn start if you need a broad picture, then drill in with the specialized tools as needed.',
      parameters: {
        type: 'object',
        properties: {
          includeEvents: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
  ];
}

// ── Dispatchers ───────────────────────────────────────────────────

export async function dispatchContextWorkspace(
  _args: Record<string, unknown>,
  deps: ContextDeps = {},
): Promise<{ output: string; workspace: ReturnType<typeof workspaceBlob> }> {
  const w = workspaceBlob(deps);
  return {
    output: `cwd=${w.cwd} platform=${w.platform}${w.remoteHost ? ` remote=${w.remoteHost}` : ''} sandbox=${w.sandboxAvailable ? 'yes' : 'no'}`,
    workspace: w,
  };
}

export async function dispatchContextWindowsList(
  _args: Record<string, unknown>,
  deps: ContextDeps = {},
): Promise<{ output: string; windows: Array<{ addr: string; id: number; title: string; foreground: boolean; paneCount: number }> }> {
  const wr = deps.getWindowRegistry?.();
  const windows: Array<{ addr: string; id: number; title: string; foreground: boolean; paneCount: number }> = [];
  if (wr) {
    const foreId = wr.current?.()?.id;
    for (const w of wr.list()) {
      windows.push({
        addr: `win:${w.id}`,
        id: w.id,
        title: w.title,
        foreground: foreId === w.id,
        paneCount: w.listPanes().length,
      });
    }
  }
  const output = windows.length
    ? windows.map(w => `${w.addr}${w.foreground ? '*' : ''} "${w.title}" panes=${w.paneCount}`).join(', ')
    : '(no virtual windows)';
  return { output, windows };
}

export async function dispatchContextWindowDetail(
  args: Record<string, unknown>,
  deps: ContextDeps = {},
): Promise<{ output: string; window?: unknown }> {
  const addr = String(args.addr ?? '');
  const m = /^(?:win:)?(\d+)$/.exec(addr.trim());
  if (!m) return { output: `invalid window addr: ${addr}` };
  const id = parseInt(m[1]!, 10);
  const wr = deps.getWindowRegistry?.();
  if (!wr) return { output: 'window registry unavailable' };
  const w = wr.list().find(x => x.id === id);
  if (!w) return { output: `unknown window win:${id}` };
  const panes = w.listPanes().map(p => ({
    addr: `pane:${p.id}`,
    id: p.id,
    kind: p.content.kind,
    title: p.content.title,
    focused: w.focused === p.id,
  }));
  return {
    output: `win:${id} "${w.title}" panes=${panes.length}: ${panes.map(p => `${p.addr}(${p.kind}${p.focused ? ',focus' : ''})`).join(', ')}`,
    window: { addr: `win:${id}`, id, title: w.title, panes },
  };
}

export async function dispatchContextPaneDetail(
  args: Record<string, unknown>,
  deps: ContextDeps = {},
): Promise<{ output: string; pane?: unknown }> {
  const addr = String(args.addr ?? '').replace(/^pane:/, '');
  if (!addr) return { output: 'missing pane addr' };
  const wr = deps.getWindowRegistry?.();
  if (!wr) return { output: 'window registry unavailable' };
  for (const w of wr.list()) {
    const p = w.listPanes().find(x => x.id === addr);
    if (!p) continue;
    const body = args.captureTail === true
      ? deps.capturePane?.(addr, typeof args.maxBytes === 'number' ? args.maxBytes : undefined)
      : undefined;
    return {
      output: `pane:${addr} (${p.content.kind}) in win:${w.id}${body ? ` tail=${body.length}B` : ''}`,
      pane: {
        addr: `pane:${addr}`, windowId: w.id, kind: p.content.kind,
        title: p.content.title, focused: w.focused === p.id,
        tail: body,
      },
    };
  }
  return { output: `unknown pane:${addr}` };
}

export async function dispatchContextPtysList(): Promise<{
  output: string;
  ptys: Array<{ addr: string; id: string; cmd: string; status: 'running' | 'exited'; ageSec: number }>;
}> {
  const now = Date.now();
  const items = listPty().map(h => ({
    addr: `pty:${h.id}`,
    id: h.id,
    cmd: h.cmd,
    status: h.isAlive() ? 'running' as const : 'exited' as const,
    ageSec: Math.max(0, Math.floor((now - h.startedAt) / 1000)),
  }));
  const output = items.length
    ? items.map(p => `${p.addr}(${p.status}/${p.ageSec}s) ${p.cmd}`).join(', ')
    : '(no PTY shells)';
  return { output, ptys: items };
}

export async function dispatchContextPtyDetail(
  args: Record<string, unknown>,
): Promise<{ output: string; pty?: unknown }> {
  const addr = String(args.addr ?? '').replace(/^pty:/, '');
  if (!addr) return { output: 'missing pty addr' };
  const h = getPty(addr);
  if (!h) return { output: `unknown pty:${addr}` };
  const tailBytes = typeof args.tailBytes === 'number' ? args.tailBytes : 2048;
  const snap = h.snapshot();
  const tail = snap.length > tailBytes ? snap.slice(-tailBytes) : snap;
  return {
    output: `pty:${addr} ${h.isAlive() ? 'running' : `exited(${h.exitCode})`} cmd="${h.cmd}" tail=${tail.length}B`,
    pty: {
      addr: `pty:${addr}`, id: addr, cmd: h.cmd, workdir: h.workdir,
      startedAt: h.startedAt, exitCode: h.exitCode, exitSignal: h.exitSignal,
      alive: h.isAlive(), detach: h.detach, tail,
    },
  };
}

export async function dispatchContextSessionsList(
  _args: Record<string, unknown>,
  deps: ContextDeps = {},
): Promise<{ output: string; sessions: Array<{ addr: string; id: string; title: string; state: string }> }> {
  const list = deps.getTerminalSessions?.() ?? [];
  const sessions = list.map(s => ({ addr: `sess:${s.id}`, ...s }));
  return {
    output: sessions.length
      ? sessions.map(s => `${s.addr}(${s.state}) "${s.title}"`).join(', ')
      : '(no terminal sessions)',
    sessions,
  };
}

// Surface-unification v2.2 V2.2-5 (2026-05-11) — `context.jobs.list`
// tool retired together with the dashboard scheduler view. Scheduled
// work is now first-class workflow surface (`scheduleTrigger` nodes ·
// `/workflows` listing · `~/.monad/workflows-runs/`). LLMs that need a
// "what's scheduled" view consult the workflows path directly.

export async function dispatchContextWidgetsList(): Promise<{
  output: string;
  widgets: Array<{ addr: string; id: string }>;
}> {
  const widgets = getGlobalElementRegistry().list('widget').map(w => ({ addr: w.addr, id: w.id }));
  return {
    output: widgets.length ? widgets.map(w => w.addr).join(', ') : '(no widgets mounted)',
    widgets,
  };
}

export async function dispatchContextPluginsList(): Promise<{
  output: string;
  plugins: Array<{ addr: string; id: string }>;
}> {
  const plugins = getGlobalElementRegistry().list('plugin').map(p => ({ addr: p.addr, id: p.id }));
  return {
    output: plugins.length ? plugins.map(p => p.addr).join(', ') : '(no plugins active)',
    plugins,
  };
}

export async function dispatchContextToolsList(
  args: Record<string, unknown>,
): Promise<{
  output: string;
  tools: Array<{ id: string; host: string[]; safety: string[]; defaultEnabled: boolean }>;
}> {
  const host = typeof args.host === 'string' ? args.host : undefined;
  const tools = nativeToolCatalog
    .filter(t => !host || host === 'all' || t.host.includes('all') || t.host.includes(host as any))
    .map(t => ({
      id: t.id,
      host: t.host,
      safety: t.safety,
      defaultEnabled: t.defaultEnabled,
    }));
  return {
    output: tools.length ? `${tools.length} tools: ${tools.map(t => t.id).join(', ')}` : '(no tools)',
    tools,
  };
}

export async function dispatchContextEventsTail(
  args: Record<string, unknown>,
): Promise<{
  output: string;
  events: Array<{ ts: number; addr: string; kind: ElementKind; type: ElementEventType; payload?: unknown }>;
}> {
  const kinds = Array.isArray(args.kinds) ? (args.kinds as ElementKind[]) : undefined;
  const types = Array.isArray(args.types) ? (args.types as ElementEventType[]) : undefined;
  const sinceTs = typeof args.sinceTs === 'number' ? args.sinceTs : undefined;
  const addr = typeof args.addr === 'string' ? args.addr : undefined;
  const limit = typeof args.limit === 'number' ? args.limit : 64;
  const events = getGlobalElementEventBus().tail({ sinceTs, kinds, types, addr, limit });
  return {
    output: events.length ? `${events.length} events` : '(no events)',
    events: events.map(e => ({ ts: e.ts, addr: e.addr, kind: e.kind, type: e.type, payload: e.payload })),
  };
}

export async function dispatchContextBootstrap(
  args: Record<string, unknown>,
  deps: ContextDeps = {},
): Promise<{ output: string; [k: string]: unknown }> {
  const [workspace, windows, ptys, sessions, tools] = await Promise.all([
    dispatchContextWorkspace({}, deps),
    dispatchContextWindowsList({}, deps),
    dispatchContextPtysList(),
    dispatchContextSessionsList({}, deps),
    dispatchContextToolsList({}),
  ]);
  const events = args.includeEvents === true
    ? await dispatchContextEventsTail({ limit: 32 })
    : undefined;
  const storeSize = getGlobalElementStateStore().size();
  return {
    output: [
      workspace.output,
      `windows: ${windows.output}`,
      `ptys: ${ptys.output}`,
      `sessions: ${sessions.output}`,
      tools.output,
      `state-store entries: ${storeSize}`,
    ].join(' | '),
    workspace: workspace.workspace,
    windows: windows.windows,
    ptys: ptys.ptys,
    sessions: sessions.sessions,
    tools: tools.tools,
    events: events?.events,
  };
}
