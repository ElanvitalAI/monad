// ── Capture* runtimes — pane substrate ↔ LLM tool bridge ──
//
// Wraps dispatchScreenshot / dispatchInspectPane in the ToolRuntime
// shape so dashboard / skill-runner / future MCP export use the same
// one-liner `dispatchToolByName('Screenshot', args, ctx)`.
//
// Read-only by design — neither tool mutates pane state. No approval
// prompt, no audit gate; the dashboard surface can still set
// requireApproval if future policy demands it.

import {
  buildInspectPaneTool,
  buildScreenshotTool,
  dispatchInspectPane,
  dispatchScreenshot,
} from '../capture/capture-tools.js';
import { sidecarToSummaryLine, sidecarToSystemNote, type SidecarLocale } from '../capture/posture-sidecar.js';
import { composeScreenshotMeta, type ScreenshotMetaSourcesDeps } from '../capture/screenshot-with-meta.js';
import type { SurfaceSourceDeps } from '../capture/sources/surface-source.js';
import type { SurfaceUIDeps } from '../surface/llm-tools.js';
import { registerToolRuntime } from './registry.js';
import type { ToolRuntime } from './types.js';

type Args = Record<string, unknown>;
type Out = { output: string };

function stringifyOutput(obj: unknown): Out {
  return { output: JSON.stringify(obj) };
}

/** Bundle 6T — deps closure captured at register time · dashboard
 *  supplies the live ModalIdentityRegistry lookup, DisplayCoordinator
 *  surface resolver, and widget-host read-only facade. Re-registering
 *  updates the surface used by in-flight runs (test harness path). */
let _depsRef: SurfaceSourceDeps = {};

/** Bundle B-9-α — InspectPane shim delegate forwards these deps to
 *  `dispatchDescribeSurface` so visualState (from `PaneVisualStateStore`)
 *  is reachable through the old InspectPane entry point. Separate from
 *  `_depsRef` because SurfaceSourceDeps (capture path) and SurfaceUIDeps
 *  (describe path) are structurally distinct — only intersecting at
 *  `widgetHost`. */
let _inspectDepsRef: SurfaceUIDeps = {};

/** Phase A (Capture Fabric · X2 closure) — opt-in posture sidecar deps.
 *
 *  When supplied, every `Screenshot` dispatch result is enriched with
 *  `meta` (ScreenshotWithMeta) and `sidecarText` (LLM-friendly system
 *  note). LLMs that read the tool result as JSON see both the original
 *  base output AND the sidecar context — no separate tool call needed.
 *
 *  Default: undefined → behavior unchanged (Screenshot returns base only).
 *  Dashboard wires this with the live registry's posture resolver +
 *  recentIntents ring buffer (mirrors the PFC attacher path). */
let _metaDepsRef: ScreenshotMetaSourcesDeps | null = null;
let _metaLocaleRef: SidecarLocale = 'en';

/** Phase A · X2 closure — enrich a Screenshot result with posture sidecar
 *  fields when metaDeps is supplied. Pure function, exported for tests
 *  so the enrich behaviour is verifiable without re-wiring the runtime
 *  registry or stubbing module-level imports. */
export function enrichScreenshotResult<TBase extends Record<string, unknown>>(
  base: TBase,
  req: Record<string, unknown>,
  metaDeps: ScreenshotMetaSourcesDeps | null,
  locale: SidecarLocale = 'en',
): TBase | (TBase & {
  _meta: ReturnType<typeof composeScreenshotMeta<TBase>>;
  _sidecarText: string;
  _sidecarSummary: string;
}) {
  if (!metaDeps) return base;
  const meta = composeScreenshotMeta(
    base,
    req as { surfaceId?: string; windowId?: string; paneId?: string },
    metaDeps,
  );
  return {
    ...base,
    _meta: meta,
    _sidecarText: sidecarToSystemNote(meta, { locale }),
    _sidecarSummary: sidecarToSummaryLine(meta, { locale }),
  };
}

export const screenshotRuntime: ToolRuntime<Args, Out> = {
  id: 'capture_screenshot',
  spec: buildScreenshotTool(),
  async run(req) {
    const result = await dispatchScreenshot(req, _depsRef);
    const enriched = enrichScreenshotResult(
      result as unknown as Record<string, unknown>,
      req,
      _metaDepsRef,
      _metaLocaleRef,
    );
    return stringifyOutput(enriched);
  },
};

export const inspectPaneRuntime: ToolRuntime<Args, Out> = {
  id: 'capture_inspect_pane',
  spec: buildInspectPaneTool(),
  async run(req) {
    const result = dispatchInspectPane(req, _inspectDepsRef);
    return stringifyOutput(result);
  },
};

export const CAPTURE_RUNTIMES = [screenshotRuntime, inspectPaneRuntime];

let registered = false;

export interface RegisterCaptureRuntimesOpts extends SurfaceSourceDeps {
  /** B-9-α — forwarded to `dispatchInspectPane` so the shim reaches
   *  `DescribeSurface(pane)` with a live `PaneVisualStateStore`. */
  readonly inspectDeps?: SurfaceUIDeps;
  /** Phase A — opt-in posture sidecar deps. When supplied, every
   *  Screenshot dispatch result is wrapped with `_meta` + `_sidecarText`
   *  + `_sidecarSummary`. Dashboard typically wires this from the live
   *  registry's posture resolver and recent intents ring buffer. */
  readonly metaDeps?: ScreenshotMetaSourcesDeps;
  /** Phase A — locale for the sidecar text rendering. Default 'en'. */
  readonly metaLocale?: SidecarLocale;
}

/** Idempotent registration — called by dashboard boot. Skill surface
 *  can also call this (e.g. from a test harness) without the second
 *  call clobbering the first. Bundle 6T: accepts optional deps so the
 *  dashboard can supply widget-host + modal surface resolver for the
 *  extended SurfaceAddress capture path. B-9-α adds `inspectDeps` for
 *  the InspectPane → DescribeSurface shim. Re-calling updates deps. */
export function registerCaptureRuntimes(opts: RegisterCaptureRuntimesOpts = {}): void {
  const { inspectDeps, metaDeps, metaLocale, ...sourceDeps } = opts;
  _depsRef = sourceDeps;
  _inspectDepsRef = inspectDeps ?? {};
  _metaDepsRef = metaDeps ?? null;
  _metaLocaleRef = metaLocale ?? 'en';
  if (registered) return;
  for (const rt of CAPTURE_RUNTIMES) registerToolRuntime(rt);
  registered = true;
}

/** Test-only — reset so integration tests can re-run registration. */
export function __resetCaptureRuntimesForTest(): void {
  registered = false;
  _depsRef = {};
  _inspectDepsRef = {};
  _metaDepsRef = null;
  _metaLocaleRef = 'en';
}
