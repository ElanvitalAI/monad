// Transient terminal modal helper.
//
// Paints an ANSI-preformatted block of lines as a centered coordinator
// modal, auto-dismisses after a TTL, and auto-replaces any prior
// transient modal (singleton semantics). ESC dismissal is expected to
// come from the dashboard key loop — this module only owns render +
// lifecycle, not key routing (matches chat-picker-modals precedent).

import { ansi, C, visibleWidth, stripAnsi } from '../../tui.js';
import type { ModalSurface, ModalBounds } from '../../display/modal-stack.js';
import type { DisplayCoordinator } from '../../display/coordinator.js';
import { debug } from '../../debug/log.js';

/** Result handle for the caller. dispose() is idempotent. */
export interface TransientTerminalModalHandle {
  readonly id: string;
  dispose(): void;
  readonly bounds: ModalBounds;
}

export interface ShowTransientTerminalModalParams {
  id?: string;
  title: string;
  /** ANSI-styled lines — will NOT be re-wrapped. */
  lines: string[];
  /** Width override. Default: 70% of termCols (clamped to ≥40, ≤termCols-4). */
  width?: number;
  /** Height override. Default: 70% of termRows (clamped to content, ≤termRows-4). */
  height?: number;
  /** Full bounds override. Wins over width/height/center. Use for
   *  non-centered placements like bottom-right toasts. */
  bounds?: ModalBounds;
  /** Auto-dismiss delay. Pass 0 to make it persistent. Default 2500ms. */
  ttlMs?: number;
  /** Current terminal dimensions. Caller supplies (dashboard knows). */
  termCols: number;
  termRows: number;
  coordinator: DisplayCoordinator;
  /** Singleton group key — a second modal with the same key replaces
   *  the first. Default group = 'transient'. Pass a unique key to
   *  keep two transient modals on screen simultaneously. */
  group?: string;
  /** Optional timer injection (for tests). Defaults to setTimeout. */
  schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearSchedule?: (h: ReturnType<typeof setTimeout>) => void;
  /** Fires once when the modal is disposed — via TTL, replacement in
   *  its group, or explicit dispose(). Used by KGP image preview to
   *  emit the delete-APC so the terminal cache doesn't accumulate
   *  orphan images over a long session. Exceptions are swallowed. */
  onDispose?: () => void;
}

/** Registry of live handles keyed by `group`. When a caller spawns
 *  a new modal in the same group, the prior one disposes first. */
const activeByGroup = new Map<string, TransientTerminalModalHandle>();

let idCounter = 0;

export const DEFAULT_TRANSIENT_TTL_MS = 2500;

export function showTransientTerminalModal(
  params: ShowTransientTerminalModalParams,
): TransientTerminalModalHandle {
  const group = params.group ?? 'transient';
  const prior = activeByGroup.get(group);
  if (prior) prior.dispose();

  const id = params.id ?? `transient-term:${++idCounter}`;
  const bounds = computeBounds(params);
  const ttlMs = params.ttlMs ?? DEFAULT_TRANSIENT_TTL_MS;
  if (debug.enabled) {
    debug.log('window.showTransientTerminalModal', id, {
      id,
      group,
      title: params.title,
      lineCount: params.lines.length,
      bounds: { ...bounds },
      ttlMs,
      replacedPrior: !!prior,
    });
  }
  const schedule = params.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const clearSchedule = params.clearSchedule ?? ((h) => clearTimeout(h));

  const surface: ModalSurface = {
    id,
    owner: 'dashboard',
    kind: 'modal',
    // focus:'owns' so the surface lands in focus.stack and the
    // overlay render path picks it up. We intentionally omit onKey,
    // so routeKey falls through to chat/dashboard — the modal never
    // actually steals keystrokes. ESC dismissal happens via the
    // dashboard key loop (not here).
    focus: 'owns',
    priority: 200,
    // IDX-F4 — tooltip tier matches its non-capturing overlay role
    // (passive paint, no onKey). Sits at the top of TIER_ORDER so
    // it can appear above any other modal without violating layering.
    tier: 'tooltip',
    bounds,
    render: () => [],
    paint: () => paintTransientTerminal({
      bounds,
      title: params.title,
      lines: params.lines,
    }),
    cursor: () => null,          // transient never claims caret
  };

  // B-3c pilot #4 (2026-04-21) — typed primitive push. The typed
  // type `'transient-term'` is pre-registered in B-3a's
  // APP_MODAL_TYPES (tier: tooltip). Coord's mounted/disposed
  // reverse-wiring (B-3b Part 2) drives upsertSurface +
  // closeSurface, so this call site no longer needs
  // params.coordinator.pushModal(surface).
  //
  // Generalizes the B-3b / B-3c pilot pattern to a different tier
  // (`tooltip` vs `popup`/`dialog`) and a different router model
  // (no approvalModalRouter — transient uses `activeByGroup` Map
  // for singleton-per-group semantics). Session A turf 0 touch;
  // single-file change in src/dashboard-transient-modal.ts.
  //
  // idempotencyKey = group — matches the existing "singleton per
  // group" semantics `activeByGroup` already enforces manually.
  // The primitive's `replace` policy disposes the prior handle for
  // the same key; the `activeByGroup.get(group)?.dispose()` above
  // is redundant after migration but kept for explicitness (the
  // prior dispose triggers our own disposePrimitive chain which is
  // idempotent). Keeping it preserves the existing `onDispose`
  // fire ordering.
  const primitiveHandle = params.coordinator.modalLifecycleAPI().push(
    'transient-term',
    { idempotencyKey: `transient-term:${group}` },
    surface,
  );
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (timer !== null) clearSchedule(timer);
    timer = null;
    if (activeByGroup.get(group) === handle) activeByGroup.delete(group);
    if (primitiveHandle && !primitiveHandle.isDisposed()) {
      try { primitiveHandle.dispose(); } catch { /* coordinator already disposed */ }
    }
    if (params.onDispose) {
      try { params.onDispose(); } catch { /* never let dispose callbacks break modal teardown */ }
    }
  };

  if (ttlMs > 0) {
    timer = schedule(dispose, ttlMs);
  }

  const handle: TransientTerminalModalHandle = { id, dispose, bounds };
  activeByGroup.set(group, handle);
  return handle;
}

/** For tests — wipe the singleton registry so state doesn't leak. */
export function _resetTransientTerminalModalsForTesting(): void {
  for (const h of [...activeByGroup.values()]) h.dispose();
  activeByGroup.clear();
}

/** Current handle in a group (or 'transient'), if any. Exposed for
 *  dashboard's ESC handler to find-and-dispose. */
export function currentTransientTerminalModal(group = 'transient'): TransientTerminalModalHandle | null {
  return activeByGroup.get(group) ?? null;
}

// ─── Internals ──────────────────────────────────────────────────

interface PaintInput {
  bounds: ModalBounds;
  title: string;
  lines: string[];
}

function paintTransientTerminal(input: PaintInput): string {
  const { row, col, width, height } = input.bounds;
  if (width < 4 || height < 3) return '';
  const out: string[] = [];

  // Chrome: 1 row of top border (title is folded in) + N content rows
  // + 1 row of bottom border. innerHeight already reserves both
  // borders, so contentRows === innerHeight. The previous -1 here
  // was a double-subtraction that left row (height-2) unpainted,
  // producing a blank strip that looked "torn" at larger heights.
  // NT-B3 fix 2026-04-18.
  const innerWidth = width - 2;       // borders
  const innerHeight = height - 2;
  const contentRows = innerHeight;

  // Top border w/ title.
  const titleRaw = input.title.length > innerWidth - 4
    ? input.title.slice(0, innerWidth - 5) + '…'
    : input.title;
  const titleStyled = ` ${C.accent(titleRaw)} `;
  const titleVW = visibleWidth(stripAnsi(titleStyled));
  const leftPad = Math.max(0, Math.floor((innerWidth - titleVW) / 2));
  const rightPad = Math.max(0, innerWidth - titleVW - leftPad);
  out.push(
    ansi.moveTo(row, col) +
    C.muted('┌') +
    C.muted('─'.repeat(leftPad)) +
    titleStyled +
    C.muted('─'.repeat(rightPad)) +
    C.muted('┐'),
  );

  // Content rows — top-aligned; pad bottom with empty rows.
  for (let i = 0; i < contentRows; i++) {
    const r = row + 1 + i;
    const raw = input.lines[i] ?? '';
    const vw = visibleWidth(stripAnsi(raw));
    const content = vw > innerWidth
      ? truncateAnsi(raw, innerWidth)      // hard-clip to prevent bleed
      : raw + ' '.repeat(Math.max(0, innerWidth - vw));
    out.push(
      ansi.moveTo(r, col) +
      C.muted('│') +
      content +
      C.muted('│'),
    );
  }

  // Bottom border.
  out.push(
    ansi.moveTo(row + height - 1, col) +
    C.muted('└') +
    C.muted('─'.repeat(innerWidth)) +
    C.muted('┘'),
  );

  return out.join('');
}

/** Truncate an ANSI-styled line to a target visible width, emitting
 *  SGR reset at the cut so downstream cells don't inherit the
 *  attribute. This is deliberately simple — good enough for the
 *  modal's "hard clip" need, not a general-purpose ANSI truncator. */
function truncateAnsi(s: string, maxVW: number): string {
  // Fast path — no escapes.
  if (!s.includes('\x1b')) {
    const trimmed = s.slice(0, maxVW - 1) + '…';
    const vw = visibleWidth(trimmed);
    return trimmed + ' '.repeat(Math.max(0, maxVW - vw));
  }
  // Slow path — walk codepoints + skip SGR.
  let out = '';
  let vw = 0;
  const escRe = /\x1b\[[0-9;]*m/y;
  let i = 0;
  while (i < s.length && vw < maxVW - 1) {
    escRe.lastIndex = i;
    const m = escRe.exec(s);
    if (m && m.index === i) {
      out += m[0];
      i += m[0].length;
      continue;
    }
    const ch = s[i]!;
    out += ch;
    vw += visibleWidth(ch);
    i++;
  }
  out += '…\x1b[0m';
  const tailPad = Math.max(0, maxVW - vw - 1);
  return out + ' '.repeat(tailPad);
}

function computeBounds(params: ShowTransientTerminalModalParams): ModalBounds {
  if (params.bounds) return clampBounds(params.bounds, params.termCols, params.termRows);
  // On narrow tablets the Math.max(40, …) floor would otherwise force
  // a 40-col modal into a 30-col screen. Drop the floor when the
  // terminal can't accommodate it, and clamp the final bounds so the
  // paint never runs off the edge and wraps.
  const minWidth = Math.min(40, Math.max(4, params.termCols - 2));
  const minHeight = Math.min(6, Math.max(3, params.termRows - 2));
  const width = params.width
    ?? Math.max(minWidth, Math.min(params.termCols - 4, Math.floor(params.termCols * 0.7)));
  const rawHeight = params.height
    ?? Math.max(minHeight, Math.min(params.termRows - 4, Math.floor(params.termRows * 0.7)));
  const contentHeight = params.lines.length + 2;
  const height = params.height ? rawHeight : Math.min(rawHeight, Math.max(minHeight, contentHeight));
  const row = Math.max(1, Math.floor((params.termRows - height) / 2) + 1);
  const col = Math.max(1, Math.floor((params.termCols - width) / 2) + 1);
  return clampBounds({ row, col, width, height }, params.termCols, params.termRows);
}

function clampBounds(b: ModalBounds, termCols: number, termRows: number): ModalBounds {
  const col = Math.max(1, Math.min(b.col, Math.max(1, termCols)));
  const row = Math.max(1, Math.min(b.row, Math.max(1, termRows)));
  const width = Math.max(4, Math.min(b.width, Math.max(4, termCols - col + 1)));
  const height = Math.max(3, Math.min(b.height, Math.max(3, termRows - row + 1)));
  return { row, col, width, height };
}
