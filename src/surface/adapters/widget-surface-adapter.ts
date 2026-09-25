// ── IUL Phase S·b — widget-surface adapter ──
//
// Bridges `WidgetHost` instance lifecycle into `SurfaceRegistry`.
// Mirror-image of modal-surface-adapter — subscribes to onMount /
// onDispose and registers/unregisters a `{kind:'widget', widgetId}`
// entry per instance.
//
// Wiring is opt-in: dashboard.ts (Bundle 3 Phase 3) calls this once
// at boot against the global SurfaceRegistry + the dashboard's
// WidgetHost. After that every spawn / dispose flows into the
// registry automatically.
//
// `kindTag` defaults to the widget *type* string ('sparkline' /
// 'scratch' / 'iul-canvas' / ...). Override via `kindTagOf` if
// you want richer categorization (e.g. 'consumer' / 'composer' /
// 'sketch'). `tier` defaults to `'vw'` since widgets live in the
// VW host surface; Phase Z will revisit when WR-3 lands the
// `WidgetContext.zTier` accessor.

import type { SurfaceRegistry } from '../registry.js';
import type { WidgetHost, WidgetLifecycleEvent } from '../../widgets/host.js';
import { getSurfaceRegistry } from '../registry.js';

export interface WidgetSurfaceAdapterOpts {
  readonly registry?: SurfaceRegistry;
  readonly widgetHost: WidgetHost;
  /** Override the kindTag derivation. Default: widget type. */
  readonly kindTagOf?: (event: WidgetLifecycleEvent) => string;
  /** Override the title derivation. Default: `${type}(${instanceId})`. */
  readonly titleOf?: (event: WidgetLifecycleEvent) => string;
  /** Override the tier hint. Default: 'vw'. */
  readonly tierOf?: (event: WidgetLifecycleEvent) => string;
}

export interface WidgetSurfaceAdapterHandle {
  /** Detach from the widget host. SurfaceRegistry entries registered
   *  before disposal stay; caller may call `registry.reset()` if a
   *  full sweep is wanted. */
  dispose(): void;
}

export function wireWidgetSurfaceAdapter(
  opts: WidgetSurfaceAdapterOpts,
): WidgetSurfaceAdapterHandle {
  const registry = opts.registry ?? getSurfaceRegistry();
  const kindTagOf = opts.kindTagOf ?? defaultKindTagOf;
  const titleOf = opts.titleOf ?? defaultTitleOf;
  const tierOf = opts.tierOf ?? defaultTierOf;

  const offMount = opts.widgetHost.onMount(event => {
    registry.register({
      addr: { kind: 'widget', widgetId: event.instanceId },
      kindTag: kindTagOf(event),
      surfaceId: event.instanceId,
      tier: tierOf(event),
      title: titleOf(event),
      visible: true,
    });
  });

  const offDispose = opts.widgetHost.onDispose(event => {
    registry.unregister({ kind: 'widget', widgetId: event.instanceId });
  });

  return {
    dispose() {
      offMount();
      offDispose();
    },
  };
}

function defaultKindTagOf(event: WidgetLifecycleEvent): string {
  return event.type;
}

function defaultTitleOf(event: WidgetLifecycleEvent): string {
  return `${event.type}(${event.instanceId})`;
}

function defaultTierOf(_event: WidgetLifecycleEvent): string {
  return 'vw';
}
