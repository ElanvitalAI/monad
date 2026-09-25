// ── IUL Phase R §3.2 · B-10-α — ShellRegistry ↔ SurfaceRegistry wiring ──
//
// Bridges `ShellRegistry` register/unregister events into
// `SurfaceRegistry` so LLM observability tools (`GetUIState({kind:'bg'})`
// / `ObserveSurface({kind:'bg'})`) see live shell handles in real time.
//
// Why a dedicated adapter rather than reusing `bindBackgroundSurfaceToRegistry`:
// that helper mirrors an aggregated `BackgroundSurface` snapshot and
// requires callers to tick `syncNow()`. The Phase P7-γ requirement is
// reactive mirroring on every register/unregister without a polling
// tick, which maps naturally onto the new multi-subscriber bus added to
// ShellRegistry in B-10-α.
//
// Default filter: bg-mode handles only. inline / modal / vw handles
// already appear in SurfaceRegistry through their own adapters
// (inline-surface-adapter, modal-surface-adapter, pane-surface-adapter);
// adding them here would double-register. Callers can override via
// `filterModes` when they want broader observability (e.g. skill-runner
// telemetry or tests that care about every mode).
//
// Ownership: terminal-team turf. ShellRegistry + SurfaceRegistry are
// both terminal-owned; this adapter is additive (no existing call site
// changes) and safe to install from dashboard boot.

import { debug } from '../../debug/log.js';
import type { ShellHandle, ShellRegistry } from '../../shell-runner/types.js';
import {
  registerBackgroundHandle,
  unregisterBackgroundHandle,
} from './bg-surface-adapter.js';
import type { SurfaceRegistry } from '../registry.js';
import { getSurfaceRegistry } from '../registry.js';

export interface WireShellRunnerSurfaceOpts {
  readonly shellRegistry: ShellRegistry;
  /** Default `getSurfaceRegistry()` singleton. */
  readonly surfaceRegistry?: SurfaceRegistry;
  /** Which shell modes to mirror as bg surfaces. Default `['bg']`.
   *  Pass `['bg','inline','modal','vw']` or `['*']` for broader
   *  observability when the other adapters are disabled in a test. */
  readonly filterModes?: readonly (ShellHandle['mode'] | '*')[];
  /** Title formatter. Default `shell:<mode>:<id>`. */
  readonly titleOf?: (handle: ShellHandle) => string;
  /** kindTag for the SurfaceRegistry entry. Default `shell-bg`. */
  readonly kindTag?: string;
}

export interface WireShellRunnerSurfaceHandle {
  /** Count of currently mirrored handles (tests + diagnostics). */
  size(): number;
  /** Unsubscribe + unregister every mirrored entry. Idempotent. */
  dispose(): void;
}

export function wireShellRunnerSurface(
  opts: WireShellRunnerSurfaceOpts,
): WireShellRunnerSurfaceHandle {
  const surfReg = opts.surfaceRegistry ?? getSurfaceRegistry();
  const modes = new Set<string>(opts.filterModes ?? ['bg']);
  const passAll = modes.has('*');
  const titleOf = opts.titleOf ?? defaultTitleOf;
  const kindTag = opts.kindTag ?? 'shell-bg';
  const owned = new Set<string>();

  const unsub = opts.shellRegistry.subscribe((ev) => {
    if (ev.kind === 'register') {
      if (!passAll && !modes.has(ev.handle.mode)) return;
      // idempotent — SurfaceRegistry.register is also idempotent but we
      // want `owned.size` to reflect actually-tracked ids for dispose.
      if (owned.has(ev.handle.id)) return;
      registerBackgroundHandle({
        registry: surfReg,
        bgId: ev.handle.id,
        kindTag,
        title: titleOf(ev.handle),
      });
      owned.add(ev.handle.id);
      if (debug.enabled) {
        debug.log('shell.surface.register', ev.handle.id, {
          mode: ev.handle.mode,
          owned: owned.size,
        });
      }
    } else {
      if (!owned.has(ev.id)) return;
      unregisterBackgroundHandle(ev.id, surfReg);
      owned.delete(ev.id);
      if (debug.enabled) {
        debug.log('shell.surface.unregister', ev.id, { owned: owned.size });
      }
    }
  });

  return {
    size: () => owned.size,
    dispose() {
      unsub();
      for (const id of owned) unregisterBackgroundHandle(id, surfReg);
      owned.clear();
    },
  };
}

function defaultTitleOf(handle: ShellHandle): string {
  return `shell:${handle.mode}:${handle.id}`;
}
