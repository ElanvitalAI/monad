// ── Capture Phase C·a (Bundle 6T) — widget source resolver ──
//
// Bridge between `WidgetHost` (widget-team owned · READ-ONLY access)
// and the capture engine. Calls `widget.render(state, ctx, character)`
// with a minimal RenderCtx so the caller sees the same lines the
// host draws during its normal layout.
//
// Cross-track ownership (PLAN-iul-closure-roadmap §0.5):
//   * `widget-host.ts` and `widget-types.ts` are widget-team owned.
//   * This module imports only TYPES from them and calls only EXISTING
//     read methods (`get` / `defFor` / `buildContext` /
//     `listInstanceIds`). Zero edits to widget-team files.
//   * The `WidgetRenderHost` interface declared here is a superset of
//     `SurfaceUIWidgetHost` (Bundle 4T) — same READ-ONLY contract,
//     extended with `buildContext` which widget-team has exposed
//     publicly since widget-arch Phase 4.

import type { WidgetContext, WidgetInstance, WidgetDef, RenderCtx } from '../../widgets/types.js';
import type { SurfaceUIWidgetHost } from '../../surface/llm-tools.js';
import { debug } from '../../debug/log.js';

export interface WidgetRenderHost extends SurfaceUIWidgetHost {
  buildContext<S = unknown>(id: string): WidgetContext<S> | null;
}

export interface WidgetSourceOpts {
  readonly widgetId: string;
  readonly dims: { readonly cols: number; readonly rows: number };
  readonly widgetHost?: WidgetRenderHost;
}

export class WidgetSourceNotFoundError extends Error {
  constructor(public readonly widgetId: string, reason: string) {
    super(`widget source unavailable (${widgetId}): ${reason}`);
    this.name = 'WidgetSourceNotFoundError';
  }
}

/** Resolve ANSI for a widget instance. Returns joined render() lines
 *  (newline-separated) so the capture engine's existing encoders (text
 *  / ansi / svg / png / asciicast) can consume it uniformly. */
export function resolveWidgetAnsi(opts: WidgetSourceOpts): string {
  const host = opts.widgetHost;
  if (!host) throw new WidgetSourceNotFoundError(opts.widgetId, 'widget-host not wired');
  const inst = host.get(opts.widgetId);
  if (!inst) throw new WidgetSourceNotFoundError(opts.widgetId, 'instance not found');
  const def = host.defFor(opts.widgetId);
  if (!def) throw new WidgetSourceNotFoundError(opts.widgetId, 'def not found');
  const ctx = host.buildContext(opts.widgetId);
  if (!ctx) throw new WidgetSourceNotFoundError(opts.widgetId, 'buildContext returned null');

  const renderCtx = buildMinimalRenderCtx(ctx, opts.dims);
  try {
    const lines = (def as WidgetDef<unknown>).render(
      (inst as WidgetInstance<unknown>).state,
      renderCtx,
      inst.character,
    );
    return Array.isArray(lines) ? lines.join('\n') : '';
  } catch (err) {
    if (debug.enabled) {
      debug.log('capture.widget-source.render.error', opts.widgetId, {
        err: (err as Error)?.message ?? String(err),
      }, { level: 'error' });
    }
    return '';
  }
}

/** Async source closure matching CaptureRequest.source shape. */
export function createWidgetSource(opts: WidgetSourceOpts): () => string {
  return () => resolveWidgetAnsi(opts);
}

export interface WidgetDescription {
  readonly widgetId: string;
  readonly type: string;
  readonly character: string;
  readonly description?: string;
  readonly defaultCharacter?: string;
  readonly statePreview?: unknown;
}

/** Lightweight describe — no render call · pure metadata read. */
export function describeWidget(opts: Pick<WidgetSourceOpts, 'widgetId' | 'widgetHost'>): WidgetDescription | undefined {
  const host = opts.widgetHost;
  if (!host) return undefined;
  const inst = host.get(opts.widgetId);
  if (!inst) return undefined;
  const def = host.defFor(opts.widgetId);
  return {
    widgetId: opts.widgetId,
    type: inst.type,
    character: inst.character,
    ...(def ? { description: def.description } : {}),
    ...(def?.defaultCharacter !== undefined ? { defaultCharacter: def.defaultCharacter } : {}),
    statePreview: previewState(inst.state),
  };
}

/** Build a minimal `RenderCtx` from the widget's existing context so
 *  render() has the width/height/theme fields it expects. Most widgets
 *  tolerate missing optional fields; the fields below are the ones
 *  render paths consistently read.
 *
 *  Note: `WidgetContext<S>` already carries most of what `RenderCtx`
 *  needs; we extend with explicit dims so the capture target chooses
 *  its own cols/rows independent of the actual pane placement. */
function buildMinimalRenderCtx(
  ctx: WidgetContext<unknown>,
  dims: { readonly cols: number; readonly rows: number },
): RenderCtx {
  return {
    ...(ctx as unknown as RenderCtx),
    width: dims.cols,
    height: dims.rows,
  } as RenderCtx;
}

function previewState(state: unknown): unknown {
  if (state === null || state === undefined) return state;
  if (typeof state !== 'object') return state;
  const out: Record<string, unknown> = {};
  let i = 0;
  for (const [k, v] of Object.entries(state)) {
    if (i >= 8) { out['…'] = `+${Object.keys(state).length - 8} more`; break; }
    if (typeof v === 'string' && v.length > 80) out[k] = v.slice(0, 80) + '…';
    else if (Array.isArray(v)) out[k] = `[Array(${v.length})]`;
    else if (v && typeof v === 'object') out[k] = '[Object]';
    else out[k] = v;
    i += 1;
  }
  return out;
}
