// /rebind slash command backend — R3 + R7.
//
// Pure helpers that parse /rebind args and return a structured
// outcome. The slash handler in dashboard.ts renders the outcome as
// chatLines; nothing in this module touches the terminal.
//
// Subcommand grammar:
//   /rebind                              → list all bindings
//   /rebind actions                      → list registered actions
//   /rebind <actionId>                   → show one action's bindings
//   /rebind <actionId> <matcher…>        → add runtime bindings
//   /rebind reset <actionId>             → clear runtime layer for action
//   /rebind export [path]                → dump user+runtime bindings
//                                          (path omitted → returns JSON body)
//   /rebind import <path>                → load a bindings JSON into
//                                          runtime layer
//
// This module intentionally does NOT read / write user-config file
// — rebind operates on the RUNTIME layer. Export writes a file the
// user can later move into ~/.elanous/input-bindings.json if they
// want the override to persist across restarts.

import { readFileSync, writeFileSync } from 'node:fs';
import {
  listAllBindings,
  setRuntimeBinding,
  clearRuntimeBindingForAction,
  type Binding,
} from './bindings.js';
import { listActions, hasAction } from './actions.js';
import { validateRebind, type ReservationViolation } from './reserved.js';
import { SUPPORTED_VERSION as USER_CONFIG_VERSION } from './user-config-loader.js';
import type { ContextTag } from './context.js';

export interface RebindLine { tone: 'text' | 'muted' | 'warn' | 'error' | 'success'; text: string }
export interface RebindOutcome { lines: RebindLine[]; ok: boolean }

/** Top-level dispatcher. Returns an outcome that the caller renders
 *  into chatLines. Never throws — malformed input becomes an error
 *  line. */
export function runRebindCommand(args: string[]): RebindOutcome {
  const sub = (args[0] ?? '').toLowerCase();

  if (args.length === 0) return listBindingsOutcome();
  if (sub === 'actions') return listActionsOutcome();
  if (sub === 'reset') return resetOutcome(args.slice(1));
  if (sub === 'export') return exportOutcome(args.slice(1));
  if (sub === 'import') return importOutcome(args.slice(1));
  if (sub === 'help' || sub === '?') return helpOutcome();
  // Treat first arg as actionId; remaining = matchers
  return addOrShowOutcome(args);
}

function listBindingsOutcome(): RebindOutcome {
  const all = listAllBindings();
  const lines: RebindLine[] = [];
  if (all.length === 0) {
    lines.push({ tone: 'muted', text: '  [rebind] no bindings registered (default + user-config + runtime)' });
    return { lines, ok: true };
  }
  lines.push({ tone: 'muted', text: `  [rebind] ${all.length} bindings total` });
  lines.push({ tone: 'muted', text: '    source       matcher                actionId                      context' });
  for (const b of all) {
    const src = b.source.padEnd(12);
    const mat = b.matcher.padEnd(22);
    const aid = b.actionId.padEnd(30);
    const ctx = b.context ?? '(global)';
    lines.push({ tone: 'text', text: `    ${src} ${mat} ${aid} ${ctx}` });
  }
  return { lines, ok: true };
}

function listActionsOutcome(): RebindOutcome {
  const acts = listActions();
  const lines: RebindLine[] = [
    { tone: 'muted', text: `  [rebind] ${acts.length} actions registered` },
  ];
  for (const a of acts) {
    const flag = a.reserved ? ' [reserved]' : '';
    const desc = a.description ? ` — ${a.description}` : '';
    lines.push({ tone: 'text', text: `    ${a.id}${flag}${desc}` });
  }
  return { lines, ok: true };
}

function resetOutcome(args: string[]): RebindOutcome {
  const actionId = args[0];
  if (!actionId) {
    return { lines: [{ tone: 'warn', text: '  usage: /rebind reset <actionId>' }], ok: false };
  }
  clearRuntimeBindingForAction(actionId);
  return {
    lines: [{ tone: 'success', text: `  [rebind] cleared runtime bindings for "${actionId}"` }],
    ok: true,
  };
}

function addOrShowOutcome(args: string[]): RebindOutcome {
  const actionId = args[0]!;
  const matchers = args.slice(1);

  if (matchers.length === 0) {
    // Show mode
    const hits = listAllBindings().filter(b => b.actionId === actionId);
    const lines: RebindLine[] = [];
    if (hits.length === 0) {
      const label = hasAction(actionId)
        ? `action exists but has no bindings yet`
        : `action "${actionId}" is NOT registered — try /rebind actions to list`;
      lines.push({ tone: 'warn', text: `  [rebind] ${label}` });
      return { lines, ok: false };
    }
    lines.push({ tone: 'muted', text: `  [rebind] "${actionId}" — ${hits.length} binding(s)` });
    for (const b of hits) {
      const ctx = b.context ?? '(global)';
      lines.push({ tone: 'text', text: `    ${b.source.padEnd(12)} ${b.matcher.padEnd(22)} ${ctx}` });
    }
    return { lines, ok: true };
  }

  // Add mode — parse optional --context <tag>
  let context: ContextTag | undefined;
  const cleanMatchers: string[] = [];
  for (let i = 0; i < matchers.length; i++) {
    const a = matchers[i]!;
    if (a === '--context' && i + 1 < matchers.length) {
      context = matchers[++i] as ContextTag;
    } else {
      cleanMatchers.push(a);
    }
  }

  if (cleanMatchers.length === 0) {
    return { lines: [{ tone: 'warn', text: '  [rebind] no matchers after --context flag' }], ok: false };
  }

  const violation: ReservationViolation | null = setRuntimeBinding(actionId, cleanMatchers, context);
  if (violation) {
    return {
      lines: [{ tone: 'error', text: `  [rebind] rejected: ${violation.message}` }],
      ok: false,
    };
  }
  const ctxLabel = context ? ` (context=${context})` : '';
  return {
    lines: [{
      tone: 'success',
      text: `  [rebind] "${actionId}" → [${cleanMatchers.join(', ')}]${ctxLabel}`,
    }],
    ok: true,
  };
}

function exportOutcome(args: string[]): RebindOutcome {
  const path = args[0];
  // Export only user-config + runtime bindings. Defaults are implicit
  // and don't need to be persisted — the target install has them.
  const bindings = listAllBindings()
    .filter(b => b.source !== 'default')
    .map(b => {
      const e: { matcher: string; actionId: string; context?: ContextTag } = {
        matcher: b.matcher, actionId: b.actionId,
      };
      if (b.context) e.context = b.context;
      return e;
    });
  const body = JSON.stringify({ version: USER_CONFIG_VERSION, bindings }, null, 2);
  if (!path) {
    return {
      lines: [
        { tone: 'muted', text: `  [rebind] ${bindings.length} non-default bindings` },
        ...body.split('\n').map(l => ({ tone: 'text' as const, text: '    ' + l })),
      ],
      ok: true,
    };
  }
  try {
    writeFileSync(path, body + '\n');
    return {
      lines: [{ tone: 'success', text: `  [rebind] exported ${bindings.length} bindings to ${path}` }],
      ok: true,
    };
  } catch (e) {
    return {
      lines: [{ tone: 'error', text: `  [rebind] export failed: ${String(e)}` }],
      ok: false,
    };
  }
}

function importOutcome(args: string[]): RebindOutcome {
  const path = args[0];
  if (!path) {
    return { lines: [{ tone: 'warn', text: '  usage: /rebind import <path>' }], ok: false };
  }
  let raw: string;
  try { raw = readFileSync(path, 'utf8'); }
  catch (e) {
    return { lines: [{ tone: 'error', text: `  [rebind] read failed: ${String(e)}` }], ok: false };
  }
  let parsed: { version?: unknown; bindings?: unknown };
  try { parsed = JSON.parse(raw); }
  catch (e) {
    return { lines: [{ tone: 'error', text: `  [rebind] malformed JSON: ${String(e)}` }], ok: false };
  }
  if (parsed.version !== USER_CONFIG_VERSION) {
    return {
      lines: [{
        tone: 'error',
        text: `  [rebind] version mismatch: got ${String(parsed.version)}, expected ${USER_CONFIG_VERSION}`,
      }],
      ok: false,
    };
  }
  const arr = Array.isArray(parsed.bindings) ? parsed.bindings : [];
  const lines: RebindLine[] = [];
  let applied = 0;
  let rejected = 0;
  for (const entry of arr) {
    if (typeof entry !== 'object' || entry === null) { rejected++; continue; }
    const e = entry as { matcher?: unknown; actionId?: unknown; context?: unknown };
    if (typeof e.matcher !== 'string' || typeof e.actionId !== 'string') { rejected++; continue; }
    const ctx = typeof e.context === 'string' ? (e.context as ContextTag) : undefined;
    const v = validateRebind(e.actionId, [e.matcher], ctx);
    if (v) {
      rejected++;
      lines.push({ tone: 'warn', text: `    ✗ ${e.matcher} → ${e.actionId}: ${v.message}` });
      continue;
    }
    setRuntimeBinding(e.actionId, [e.matcher], ctx);
    applied++;
  }
  lines.unshift({
    tone: applied > 0 ? 'success' : 'muted',
    text: `  [rebind] imported ${applied} bindings, ${rejected} rejected`,
  });
  return { lines, ok: rejected === 0 };
}

function helpOutcome(): RebindOutcome {
  return {
    lines: [
      { tone: 'muted', text: '  /rebind                        list all bindings' },
      { tone: 'muted', text: '  /rebind actions                list registered actions' },
      { tone: 'muted', text: '  /rebind <actionId>             show one action\'s bindings' },
      { tone: 'muted', text: '  /rebind <actionId> <matcher…>  add runtime binding' },
      { tone: 'muted', text: '     [--context <tag>]           scope to context (input, modal, …)' },
      { tone: 'muted', text: '  /rebind reset <actionId>       clear runtime binding' },
      { tone: 'muted', text: '  /rebind export [path]          dump non-default bindings' },
      { tone: 'muted', text: '  /rebind import <path>          load bindings JSON into runtime layer' },
    ],
    ok: true,
  };
}
