// ── Capture Phase C·a (Bundle 6T) — surface source dispatcher ──
//
// Single entry point that maps a `SurfaceAddress` to its resolved
// ANSI string. Branches by `addr.kind` and delegates to the per-kind
// source module (pane / modal / widget). Popover / inline / bg fall
// back to a registry-passthrough (no dedicated paint yet — they carry
// metadata only). `screen` composites via listVisibleZOrdered().
//
// Cross-track ownership:
//   * All per-kind resolvers are terminal-team owned.
//   * widget-host is READ-ONLY consumed via the `WidgetRenderHost`
//     interface (extends SurfaceUIWidgetHost from Bundle 4T).

import type { SurfaceAddress, SurfaceRegistry } from '../../surface/index.js';
import type { ModalIdentityRegistry } from '../../display/modal-identity.js';
import { resolvePaneAnsi } from './pane-source.js';
import { resolveModalAnsi, type DisplaySurfaceResolver } from './modal-source.js';
import { resolveWidgetAnsi, type WidgetRenderHost } from './widget-source.js';
import { getSurfaceRegistry } from '../../surface/index.js';

export interface SurfaceSourceDeps {
  readonly registry?: SurfaceRegistry;
  readonly identity?: ModalIdentityRegistry;
  readonly surfaceResolver?: DisplaySurfaceResolver;
  readonly widgetHost?: WidgetRenderHost;
  readonly dims?: { readonly cols: number; readonly rows: number };
}

const DEFAULT_DIMS = { cols: 80, rows: 24 };

/** Dispatcher over the 6 `SurfaceAddress` kinds. Async because
 *  pane-source is async; other kinds are synchronous but the shape
 *  stays uniform so callers `await` once.
 *
 *  `screen` composite is NOT a SurfaceAddress kind — use
 *  `resolveScreenAnsi(deps)` directly when the caller has a
 *  CaptureTarget shape with `kind:'screen'`. */
export async function resolveSurfaceAnsi(
  addr: SurfaceAddress,
  deps: SurfaceSourceDeps = {},
): Promise<string> {
  switch (addr.kind) {
    case 'pane':
      return await resolvePaneAnsi({
        windowId: addr.ref.windowId,
        paneId: addr.ref.paneId,
        ...(addr.ref.runnerLabel !== undefined ? { runnerLabel: addr.ref.runnerLabel } : {}),
      });
    case 'modal':
      return resolveModalAnsi({
        modalId: addr.modalId,
        ...(deps.identity ? { identity: deps.identity } : {}),
        ...(deps.surfaceResolver ? { surfaceResolver: deps.surfaceResolver } : {}),
      });
    case 'widget':
      return resolveWidgetAnsi({
        widgetId: addr.widgetId,
        dims: deps.dims ?? DEFAULT_DIMS,
        ...(deps.widgetHost ? { widgetHost: deps.widgetHost } : {}),
      });
    case 'popover':
    case 'inline':
    case 'bg':
    case 'window':
      // B-13-α · `window` surface is a layout container, not a
      // rendered pixel source. Fall back to the registry-metadata
      // passthrough (same shape popover/inline/bg get). Callers that
      // want the window's contents should enumerate its panes via
      // SaveLayout / LoadLayout, then capture each pane individually.
      return resolvePassthroughAnsi(addr, deps);
    default:
      // E1 / TS2366 (2026-05-17) — explicit unreachable default so
      // TypeScript sees the switch as exhaustive. Future SurfaceAddress
      // kinds added to the union without a case here will throw at
      // first invocation.
      throw new Error(`unknown surface kind: ${(addr as { kind: string }).kind}`);
  }
}

/** Popover / inline / bg don't have a paint API in the current
 *  substrate (they live in Shell Runner surfaces + mouse-wiring as
 *  closure-local state). Falls back to a registry metadata block —
 *  the LLM sees "this surface exists and what registry says about
 *  it" without a rendered frame. Future arcs can specialize. */
export function resolvePassthroughAnsi(
  addr: SurfaceAddress,
  deps: SurfaceSourceDeps,
): string {
  const registry = deps.registry ?? getSurfaceRegistry();
  const desc = registry.get(addr);
  if (!desc) return `[${addr.kind} surface not in registry]`;
  const lines = [
    `[${addr.kind}] ${desc.kindTag} · tier=${desc.tier ?? 'default'}`,
    desc.title ? `  title: ${desc.title}` : '',
    desc.surfaceId ? `  surfaceId: ${desc.surfaceId}` : '',
    `  visible: ${desc.visible} · zHint: ${desc.zHint ?? 0}`,
  ].filter(Boolean);
  return lines.join('\n');
}

/** Composite: walk `listVisibleZOrdered()` and dump each surface's
 *  ANSI with a header separator. V0 output is ordered-dump (not true
 *  z-composited paint) — good enough for LLM "show me the screen
 *  right now" · V1 can upgrade to terminal-pixel composition when
 *  Phase R lands a unified paint path. */
export async function resolveScreenAnsi(deps: SurfaceSourceDeps = {}): Promise<string> {
  const registry = deps.registry ?? getSurfaceRegistry();
  const surfaces = registry.listVisibleZOrdered();
  if (surfaces.length === 0) return '[screen: no visible surfaces]';
  const parts: string[] = [];
  for (const desc of surfaces) {
    const header = `── ${desc.addr.kind}:${describeShort(desc.addr)} (tier=${desc.tier ?? 'default'}) ──`;
    parts.push(header);
    try {
      const body = await resolveSurfaceAnsi(desc.addr, deps);
      parts.push(body || '[empty]');
    } catch (err) {
      parts.push(`[source resolution failed: ${(err as Error).message}]`);
    }
  }
  return parts.join('\n\n');
}

function describeShort(addr: SurfaceAddress): string {
  switch (addr.kind) {
    case 'pane':    return `${addr.ref.windowId}::${addr.ref.paneId}`;
    case 'modal':   return addr.modalId;
    case 'widget':  return addr.widgetId;
    case 'popover': return addr.popoverId;
    case 'inline':  return addr.inlineId;
    case 'bg':      return addr.bgId;
    case 'window':  return String(addr.windowId);
    // E1 / TS2366 — explicit unreachable default. Same rationale as
    // resolveSurfaceAnsi above.
    default:        return `unknown:${(addr as { kind: string }).kind}`;
  }
}
