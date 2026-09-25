// ── X2 (Phase 2 Bundle 1) — Screenshot + posture / intent metadata ──
//
// HANDOFF Phase 2 §5 X2: "Screenshot + posture 메타". 기존
// `dispatchScreenshot` 결과에 그 시점 substrate posture + recentIntents
// 를 metadata 로 첨부한다. PFC reverse-feedback 의 X4 attachment, 또는
// X7 vision LLM proposer 가 캡처 시점 컨텍스트를 빠르게 인지할 수 있게.
//
// Pure wrapper — `dispatchScreenshot` 본체는 건드리지 않고 호출자 측에서
// metadata 를 결합한다. `dispatchScreenshotWithMeta` 가 그 결합 함수.

import type {
  TerminalExposureSnapshot,
  TerminalSurfaceCapability,
} from '../terminal/posture.js';

export interface ScreenshotPostureMeta {
  readonly surfaceId: string;
  readonly exposure: TerminalExposureSnapshot;
  readonly capability: TerminalSurfaceCapability;
}

export interface ScreenshotIntentMeta {
  readonly kind: string;
  readonly surfaceId: string;
  readonly row: number;
  readonly col: number;
  readonly ts?: number;
}

export interface ScreenshotWithMeta<TBase = Record<string, unknown>> {
  /** Original `dispatchScreenshot` output passes through unchanged. */
  readonly base: TBase;
  /** Posture snapshot at capture time — null when no surface
   *  resolves (e.g. screen kind capture). */
  readonly posture: ScreenshotPostureMeta | null;
  /** Recent surface-intents fired before capture (from the substrate
   *  ring buffer). Newest last. */
  readonly recentIntents: readonly ScreenshotIntentMeta[];
  /** Wall-clock at metadata composition. */
  readonly composedAt: number;
}

export interface ScreenshotMetaSourcesDeps {
  /** Resolves substrate posture for the screenshot target. Returns
   *  null when the capture wasn't a single-surface call (or surface
   *  isn't tracked in registry). */
  resolvePosture?: (target: { surfaceId?: string; windowId?: string; paneId?: string }) =>
    ScreenshotPostureMeta | null;
  /** Returns the recent intents ring buffer — typically
   *  `() => terminalMouseIntentRuntime.recentIntents()` flattened
   *  to the meta shape. */
  recentIntents?: () => readonly ScreenshotIntentMeta[];
  /** Test seam. */
  now?: () => number;
}

/**
 * Wrap a screenshot dispatch result with substrate metadata. Pure
 * composition — `dispatchScreenshot` is called by the host, then the
 * raw result + the composed metadata is returned.
 */
export function composeScreenshotMeta<TBase>(
  base: TBase,
  target: { surfaceId?: string; windowId?: string; paneId?: string },
  deps: ScreenshotMetaSourcesDeps,
): ScreenshotWithMeta<TBase> {
  const now = deps.now ?? Date.now;
  const posture = deps.resolvePosture ? deps.resolvePosture(target) : null;
  const recentIntents = deps.recentIntents ? deps.recentIntents() : [];
  return {
    base,
    posture,
    recentIntents,
    composedAt: now(),
  };
}

/**
 * Convenience — call dispatchScreenshot then compose metadata in
 * one async helper. Equivalent to chaining `composeScreenshotMeta`
 * after the dispatch.
 */
export async function dispatchScreenshotWithMeta<TBase>(
  args: Record<string, unknown>,
  dispatchScreenshot: (args: Record<string, unknown>) => Promise<TBase>,
  deps: ScreenshotMetaSourcesDeps,
): Promise<ScreenshotWithMeta<TBase>> {
  const base = await dispatchScreenshot(args);
  return composeScreenshotMeta(base, args as { surfaceId?: string; windowId?: string; paneId?: string }, deps);
}
