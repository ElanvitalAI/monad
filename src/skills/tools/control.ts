// ── Control mutation tools — Phase D of PLAN-llm-active-context-and-control ──
//
// Fills the gaps that the existing virtual-window/PTY tools don't
// cover: window + pane resize, preset pane layouts (2x2 / 1x3 / …),
// LLM self-modification (tool toggle, prompt hint append).
//
// Addressing:
//   • window addr → "win:<int>" or bare "<int>"
//   • pane   addr → "pane:<hex>" or bare "<hex>"
// Resolution routes through the global ElementRegistry so PTY /
// session / widget addrs can be added later without reshaping tools.

import type { LLMToolSpec } from '../../llm.js';
import { nativeToolCatalog } from '../../native-tool-catalog.js';
import { appendPromptHint, clearPromptHints, listPromptHints, type HintScope } from '../../prompt/hint-store.js';
import { publishElementEvent } from '../../element-registry/index.js';
import { recordControlAudit } from '../../control-audit-log.js';
import type { WindowRegistry } from '../../virtual-windows/window-registry.js';
import type { PaneContentSpec, PaneFactoryDeps } from '../../virtual-windows/pane-content.js';

interface ControlDeps {
  getWindowRegistry?: () => WindowRegistry | null;
  /** Pane content used when layout preset fills empty slots. Defaults
   *  to blank terminals (kind='terminal'). Caller can override to
   *  seed panes with specific cmds. */
  defaultPaneSpec?: (slot: number) => PaneContentSpec;
  paneDeps?: PaneFactoryDeps;
}

let deps: ControlDeps = {};

export function setControlRuntimeDeps(next: ControlDeps): void {
  deps = { ...next };
}

// ── Tool specs ─────────────────────────────────────────────────────

export function buildControlTools(): LLMToolSpec[] {
  return [
    {
      name: 'ControlWindowResize',
      description:
        'Resize a virtual window. Pass width/height cells; row/col default to current position. Addr "win:3" or "3".',
      parameters: {
        type: 'object',
        properties: {
          addr: { type: 'string' },
          width: { type: 'number' },
          height: { type: 'number' },
          row: { type: 'number' },
          col: { type: 'number' },
        },
        required: ['addr'],
        additionalProperties: false,
      },
    },
    {
      name: 'ControlPaneResize',
      description:
        'Grow or shrink the split enclosing a pane. axis="h" slides the vertical divider, axis="v" slides the horizontal one. delta in cells (positive grows the pane).',
      parameters: {
        type: 'object',
        properties: {
          addr: { type: 'string' },
          axis: { type: 'string', enum: ['h', 'v'] },
          delta: { type: 'number' },
        },
        required: ['addr', 'axis', 'delta'],
        additionalProperties: false,
      },
    },
    {
      name: 'ControlPaneLayout',
      description:
        'Apply a preset layout to the target window: "2x2" (4 panes), "1x3" (3 side-by-side), "3x1" (3 stacked), "2x1", "1x2". Uses the focused pane as the root and splits outward. NOTE: this is destructive — existing splits below it get rebuilt.',
      parameters: {
        type: 'object',
        properties: {
          windowAddr: { type: 'string' },
          layout: { type: 'string', enum: ['2x2', '1x3', '3x1', '2x1', '1x2'] },
        },
        required: ['windowAddr', 'layout'],
        additionalProperties: false,
      },
    },
    {
      name: 'ControlToolToggle',
      description:
        'Turn a native tool on/off for the current session. Pass the tool id (e.g. "bash", "context_workspace") and enabled flag. Purely in-memory — resets on dashboard restart.',
      parameters: {
        type: 'object',
        properties: {
          toolId: { type: 'string' },
          enabled: { type: 'boolean' },
        },
        required: ['toolId', 'enabled'],
        additionalProperties: false,
      },
    },
    {
      name: 'ControlPromptAppend',
      description:
        'Append a short instruction to the system prompt. scope="turn" applies once (next turn only); scope="session" applies every turn until cleared. Use sparingly — every hint costs tokens.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          scope: { type: 'string', enum: ['turn', 'session'] },
        },
        required: ['text'],
        additionalProperties: false,
      },
    },
    {
      name: 'ControlPromptClear',
      description:
        'Drop pending prompt hints. scope omitted clears all; scope="session" clears only persistent hints.',
      parameters: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: ['turn', 'session'] },
        },
        additionalProperties: false,
      },
    },
  ];
}

// ── Helpers ────────────────────────────────────────────────────────

function parseWinAddr(raw: string): number | null {
  const m = /^(?:win:)?(\d+)$/.exec(String(raw).trim());
  return m ? parseInt(m[1]!, 10) : null;
}
function parsePaneAddr(raw: string): string | null {
  const s = String(raw).trim();
  const m = /^(?:pane:)?([A-Za-z0-9_-]+)$/.exec(s);
  return m ? m[1]! : null;
}

/** Emit an update event on the ElementEventBus so ContextEventsTail
 *  can replay control actions, AND append to the persistent control
 *  audit log (Phase F). Both calls are best-effort: a control action
 *  must never fail because observability is broken. */
function publishControlEvent(
  kind: 'window' | 'pane' | 'tool',
  id: string,
  payload: Record<string, unknown>,
): void {
  try { publishElementEvent(kind, id, 'update', payload); } catch { /* swallow */ }
  try {
    recordControlAudit({
      ts: new Date().toISOString(),
      action: String(payload.action ?? 'unknown'),
      subject: `${kind}:${id}`,
      ok: payload.ok !== false,
      detail: payload,
    });
  } catch { /* swallow */ }
}

/** Audit-only helper for actions that don't address a bus-tracked
 *  element (prompt hints). */
function auditAction(action: string, ok: boolean, detail?: Record<string, unknown>): void {
  try {
    recordControlAudit({ ts: new Date().toISOString(), action, ok, detail });
  } catch { /* swallow */ }
}

// ── Dispatchers ───────────────────────────────────────────────────

export async function dispatchControlWindowResize(
  args: Record<string, unknown>,
): Promise<{ output: string; ok?: boolean; bounds?: unknown }> {
  const addr = String(args.addr ?? '');
  const id = parseWinAddr(addr);
  if (id === null) return { output: `invalid window addr: ${addr}`, ok: false };
  const reg = deps.getWindowRegistry?.();
  if (!reg) return { output: 'window registry unavailable', ok: false };
  const w = reg.list().find(x => x.id === id);
  if (!w) return { output: `unknown window win:${id}`, ok: false };
  const current = w.getBounds();
  const next = {
    row: typeof args.row === 'number' ? args.row : current.row,
    col: typeof args.col === 'number' ? args.col : current.col,
    width: typeof args.width === 'number' ? args.width : current.width,
    height: typeof args.height === 'number' ? args.height : current.height,
  };
  if (next.width < 10 || next.height < 4) {
    return { output: `refused — minimum 10x4 (got ${next.width}x${next.height})`, ok: false };
  }
  w.setBounds(next);
  publishControlEvent('window', String(id), { action: 'resize', bounds: next });
  return { output: `win:${id} resized to ${next.width}x${next.height} @(${next.row},${next.col})`, ok: true, bounds: next };
}

export async function dispatchControlPaneResize(
  args: Record<string, unknown>,
): Promise<{ output: string; ok?: boolean }> {
  const addr = String(args.addr ?? '');
  const paneId = parsePaneAddr(addr);
  if (!paneId) return { output: `invalid pane addr: ${addr}`, ok: false };
  const axis = args.axis === 'h' || args.axis === 'v' ? args.axis : null;
  if (!axis) return { output: `invalid axis: ${args.axis}`, ok: false };
  const delta = typeof args.delta === 'number' ? Math.trunc(args.delta) : 0;
  if (!Number.isFinite(delta) || delta === 0) return { output: 'delta must be non-zero integer', ok: false };
  const reg = deps.getWindowRegistry?.();
  if (!reg) return { output: 'window registry unavailable', ok: false };
  for (const w of reg.list()) {
    if (!w.listPanes().some(p => p.id === paneId)) continue;
    const changed = w.resizePaneAt(paneId, axis, delta);
    publishControlEvent('pane', paneId, { action: 'resize', axis, delta, changed });
    return {
      output: changed
        ? `pane:${paneId} resized axis=${axis} delta=${delta}`
        : `pane:${paneId} no-op (hit min size or no matching-axis split)`,
      ok: changed,
    };
  }
  return { output: `unknown pane:${paneId}`, ok: false };
}

export async function dispatchControlPaneLayout(
  args: Record<string, unknown>,
): Promise<{ output: string; ok?: boolean; paneCount?: number }> {
  const wid = parseWinAddr(String(args.windowAddr ?? ''));
  if (wid === null) return { output: `invalid windowAddr: ${args.windowAddr}`, ok: false };
  const layout = String(args.layout ?? '');
  const reg = deps.getWindowRegistry?.();
  if (!reg) return { output: 'window registry unavailable', ok: false };
  const entry = reg.list().find(x => x.id === wid);
  if (!entry) return { output: `unknown window win:${wid}`, ok: false };

  // Translate layout name → list of axes to split in order. Each
  // split acts on the currently-focused pane (so layout names map
  // directly to tmux-style conventions).
  const plan: Array<{ axis: 'h' | 'v' }> = (() => {
    switch (layout) {
      case '2x1': return [{ axis: 'v' }];
      case '1x2': return [{ axis: 'h' }];
      case '1x3': return [{ axis: 'h' }, { axis: 'h' }];
      case '3x1': return [{ axis: 'v' }, { axis: 'v' }];
      case '2x2': return [{ axis: 'h' }, { axis: 'v' }, { axis: 'v' }];
      default: return [];
    }
  })();
  if (plan.length === 0) return { output: `invalid layout: ${layout}`, ok: false };

  const spec = deps.defaultPaneSpec ?? ((slot: number): PaneContentSpec => ({
    kind: 'terminal',
    title: `slot-${slot + 2}`,
  } as PaneContentSpec));
  const paneDeps = deps.paneDeps ?? {};

  // Use the registry's existing createPaneContent so we stay in sync
  // with the PaneFactoryDeps that dashboard wires.
  const { createPaneContent } = await import('../../virtual-windows/pane-content.js');
  let slot = 0;
  for (const step of plan) {
    const content = createPaneContent(spec(slot), paneDeps);
    entry.splitFocused(step.axis, content);
    slot++;
  }
  publishControlEvent('window', String(wid), { action: 'layout', layout, paneCount: entry.listPanes().length });
  return {
    output: `win:${wid} laid out as ${layout} (${entry.listPanes().length} panes)`,
    ok: true,
    paneCount: entry.listPanes().length,
  };
}

export async function dispatchControlToolToggle(
  args: Record<string, unknown>,
): Promise<{ output: string; ok: boolean }> {
  const toolId = String(args.toolId ?? '');
  const enabled = args.enabled === true;
  const entry = nativeToolCatalog.find(t => t.id === toolId || t.aliases.includes(toolId));
  if (!entry) return { output: `unknown tool: ${toolId}`, ok: false };
  entry.defaultEnabled = enabled;
  publishControlEvent('tool', entry.id, { action: 'toggle', enabled });
  return { output: `tool ${entry.id} ${enabled ? 'enabled' : 'disabled'}`, ok: true };
}

export async function dispatchControlPromptAppend(
  args: Record<string, unknown>,
): Promise<{ output: string; ok: boolean }> {
  const text = String(args.text ?? '').trim();
  if (!text) return { output: 'empty text', ok: false };
  const scope: HintScope = args.scope === 'session' ? 'session' : 'turn';
  appendPromptHint({ text, scope, origin: 'control_prompt_append' });
  auditAction('prompt_append', true, { scope, length: text.length });
  return { output: `hint stored (scope=${scope}, len=${text.length})`, ok: true };
}

export async function dispatchControlPromptClear(
  args: Record<string, unknown>,
): Promise<{ output: string; ok: boolean; remaining: number }> {
  const scope = args.scope === 'turn' || args.scope === 'session' ? args.scope : undefined;
  const before = listPromptHints().length;
  clearPromptHints(scope);
  const after = listPromptHints().length;
  auditAction('prompt_clear', true, { scope: scope ?? 'all', removed: before - after });
  return {
    output: `cleared ${before - after} hint(s)${scope ? ` (scope=${scope})` : ''}; ${after} remaining`,
    ok: true,
    remaining: after,
  };
}
