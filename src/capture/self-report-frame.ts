// ── Capture substrate · SelfReportFrame (PLAN P0) ──
//
// The unifying frame contract for the self-observation capture bus:
// any elanous surface publishes its *rendered screen text* + metadata to
// one ChannelBus channel, and consumers (elanous self screen · PWA ·
// memory · recording · a future ReAct driver) subscribe — without
// caring which surface or which production mode produced it.
//
// Text-first (NOT pixels): `text` is the post-ANSI grid from
// renderScreen(). PNG is preserved but on-demand (see `pngRef`) — never
// carried inline. cf. PLAN-self-observation-capture-substrate §2/§4.
//
// Two production modes (PLAN §3-1), transparent to consumers:
//   - 'self-report' — the surface publishes its own frame. Mandatory
//     for the interactive TUI (nobody holds its PTY handle · S1).
//   - 'forwarded'   — an external PTY-holder (a driver) publishes on
//     the surface's behalf; survives the observed freezing (+heartbeat).
//
// P0 scope = this contract + channel convention + pub/sub helpers over
// the existing ChannelBus (terminal-matrix). Producer wiring (the TUI
// self-reporting) is P1; the cross-process manifest bridge is P2. This
// module adds NO producers and touches no surface — it is the seam.

import type { ChannelBus, ChannelMessage, ChannelSubscription, SubscribeOpts } from '../terminal-matrix/channel-bus.js';

/** Surface kinds that can publish frames. Additive — new kinds append. */
export type SelfReportKind = 'tui' | 'harness' | 'preview' | 'headless';

/** Who produced the frame (PLAN §3-1). Consumers ignore unless doing
 *  liveness/robustness reasoning. */
export type SelfReportMode = 'self-report' | 'forwarded';

/** One rendered-screen frame published by a surface. */
export interface SelfReportFrame {
  /** e.g. 'tui:<pid>' · 'self-implement:<space>' · 'preview:<termId>'.
   *  Q1 규약(executor-contract·execSurfaceId)에서는 `exec:<ptyId>` — 단 그 생산 전환은 G9 소유. */
  readonly surfaceId: string;
  /** resolveInstanceName() — the operating/test scope this surface
   *  belongs to (fleet federation key · PLAN §10). */
  readonly instance: string;
  /** ⭐ K4 run-identity(2026-07-25·[[PLAN §K/K4]]) — 이 프레임이 속한 per-run join anchor(getHarnessRunId·
   *  ELANOUS_RUN_ID). 프레임 스트림을 run 단위로 join(관측→검증 접합·G5). 부재(run 밖 서피스)=생략. */
  readonly runId?: string;
  readonly kind: SelfReportKind;
  readonly mode: SelfReportMode;
  /** Rendered screen text (post-ANSI grid from renderScreen()). 1차. */
  readonly text: string;
  readonly cols: number;
  readonly rows: number;
  /** Cursor cell (1-based rows/cols mirror the terminal), if known. */
  readonly cursor?: { readonly row: number; readonly col: number };
  /** Epoch ms the frame was rendered. */
  readonly at: number;
  /** On-demand PNG pointer (path/id) — NOT inline bytes. The surface
   *  can render a PNG (renderScreenPng) when a consumer pulls it. */
  readonly pngRef?: string;
}

/** Channel prefix for per-surface frame streams: `tui-observe:<id>`. */
export const SELF_REPORT_CHANNEL_PREFIX = 'tui-observe';

/** Aggregate channel every frame ALSO publishes to — the in-process
 *  "fleet" view (subscribe here to see all surfaces at once).
 *  Deliberately OUTSIDE the `tui-observe:<id>` namespace (hyphen, not
 *  colon) so no `channelForSurface(id)` can ever collide with it — even
 *  a surface literally named 'fleet' maps to `tui-observe:fleet`, not
 *  this. Note: ChannelBus is process-local; cross-instance fleet is the
 *  manifest bridge (P2+), not this channel. */
export const SELF_REPORT_AGGREGATE_CHANNEL = 'tui-observe-fleet';

/** Per-surface channel name. */
export function channelForSurface(surfaceId: string): string {
  return `${SELF_REPORT_CHANNEL_PREFIX}:${surfaceId}`;
}

const VALID_KINDS: ReadonlySet<string> = new Set(['tui', 'harness', 'preview', 'headless']);
const VALID_MODES: ReadonlySet<string> = new Set(['self-report', 'forwarded']);

/** Structural validation. Returns null when valid, else a reason.
 *  Used on the parse path so a malformed message can't crash a
 *  consumer (fail-soft — the bus carries free-form payloads). */
export function validateSelfReportFrame(f: unknown): string | null {
  if (!f || typeof f !== 'object') return 'not an object';
  const o = f as Record<string, unknown>;
  if (typeof o.surfaceId !== 'string' || o.surfaceId.length === 0) return 'surfaceId';
  if (typeof o.instance !== 'string' || o.instance.length === 0) return 'instance';
  if (typeof o.kind !== 'string' || !VALID_KINDS.has(o.kind)) return 'kind';
  if (typeof o.mode !== 'string' || !VALID_MODES.has(o.mode)) return 'mode';
  if (typeof o.text !== 'string') return 'text';
  if (typeof o.cols !== 'number' || !Number.isFinite(o.cols)) return 'cols';
  if (typeof o.rows !== 'number' || !Number.isFinite(o.rows)) return 'rows';
  if (typeof o.at !== 'number' || !Number.isFinite(o.at)) return 'at';
  if (o.cursor !== undefined) {
    const c = o.cursor as Record<string, unknown>;
    if (!c || typeof c.row !== 'number' || typeof c.col !== 'number') return 'cursor';
  }
  if (o.pngRef !== undefined && typeof o.pngRef !== 'string') return 'pngRef';
  // K4 — optional join anchor. 있으면 non-empty 문자열만(빈 runId=run 밖 → absent 여야·생산자도 '' 생략).
  //   이 규칙이 serialization truthy-check(`frame.runId ? …`)와 정합 → round-trip 계약 유지(빈값 삭제 불일치 방지).
  if (o.runId !== undefined && (typeof o.runId !== 'string' || o.runId.length === 0)) return 'runId';
  return null;
}

/** Frame → ChannelBus publish payload. The screen text is the raw
 *  `payload` (so a dumb subscriber gets the screen directly); the
 *  structured fields ride in `meta`. `channel`/`at` are set by publish. */
export function frameToChannelMessage(
  frame: SelfReportFrame,
): Omit<ChannelMessage, 'channel' | 'at'> & { at?: number } {
  return {
    from: frame.surfaceId,
    payload: frame.text,
    at: frame.at,
    meta: {
      selfReport: true,
      surfaceId: frame.surfaceId,
      instance: frame.instance,
      kind: frame.kind,
      mode: frame.mode,
      cols: frame.cols,
      rows: frame.rows,
      ...(frame.cursor ? { cursor: frame.cursor } : {}),
      at: frame.at,
      ...(frame.pngRef ? { pngRef: frame.pngRef } : {}),
      ...(frame.runId ? { runId: frame.runId } : {}),   // K4 — 부재 시 생략(round-trip 정합)
    },
  };
}

/** ChannelBus message → SelfReportFrame. Returns null when the message
 *  isn't a valid self-report frame (fail-soft). */
export function channelMessageToFrame(msg: ChannelMessage): SelfReportFrame | null {
  const meta = msg.meta as Record<string, unknown> | undefined;
  if (!meta || meta.selfReport !== true) return null;
  const text = typeof msg.payload === 'string' ? msg.payload : msg.payload.toString('utf-8');
  // Spread-guard the optionals so an absent cursor/pngRef stays ABSENT
  // (not an explicit `undefined` key) — keeps round-trip strictly equal.
  const candidate = {
    surfaceId: meta.surfaceId,
    instance: meta.instance,
    kind: meta.kind,
    mode: meta.mode,
    text,
    cols: meta.cols,
    rows: meta.rows,
    at: meta.at,
    ...(meta.cursor !== undefined ? { cursor: meta.cursor } : {}),
    ...(meta.pngRef !== undefined ? { pngRef: meta.pngRef } : {}),
    ...(meta.runId !== undefined ? { runId: meta.runId } : {}),   // K4 — 부재 시 ABSENT 유지(round-trip 정합)
  };
  if (validateSelfReportFrame(candidate) !== null) return null;
  return candidate as SelfReportFrame;
}

/** Publish a frame to BOTH its per-surface channel and the aggregate
 *  fleet channel. Fail-soft — a bus error never propagates to the
 *  producer (self-report must never break the surface it observes). */
export function publishSelfReportFrame(bus: ChannelBus, frame: SelfReportFrame): void {
  try {
    const msg = frameToChannelMessage(frame);
    bus.publish(channelForSurface(frame.surfaceId), msg);
    bus.publish(SELF_REPORT_AGGREGATE_CHANNEL, msg);
  } catch { /* fail-soft — observation must not break the observed */ }
}

/** Subscribe to one surface's frames. Callback receives decoded frames
 *  (malformed messages are dropped, not delivered). */
export function subscribeSurfaceFrames(
  bus: ChannelBus,
  surfaceId: string,
  cb: (frame: SelfReportFrame) => void,
  opts?: SubscribeOpts,
): ChannelSubscription {
  return bus.subscribe(channelForSurface(surfaceId), (msg) => {
    const frame = channelMessageToFrame(msg);
    if (frame) cb(frame);
  }, opts);
}

/** Subscribe to ALL surfaces' frames (in-process fleet view). */
export function subscribeAllFrames(
  bus: ChannelBus,
  cb: (frame: SelfReportFrame) => void,
  opts?: SubscribeOpts,
): ChannelSubscription {
  return bus.subscribe(SELF_REPORT_AGGREGATE_CHANNEL, (msg) => {
    const frame = channelMessageToFrame(msg);
    if (frame) cb(frame);
  }, opts);
}

/** Read the replay buffer for one surface without subscribing. */
export function snapshotSurfaceFrames(
  bus: ChannelBus,
  surfaceId: string,
  limit?: number,
): SelfReportFrame[] {
  return bus.snapshot(channelForSurface(surfaceId), limit)
    .map(channelMessageToFrame)
    .filter((f): f is SelfReportFrame => f !== null);
}
