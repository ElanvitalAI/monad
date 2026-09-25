// ── Capture Phase 2 (partial) — PaneRef source resolver ──
//
// Bridge between the substrate `PaneFactory` and the capture engine.
// `capture()` today takes a caller-supplied `source: () => string`; for
// pane-targeted captures this helper builds that closure by resolving
// a PaneRef to its substrate `Pane` and calling `snapshot({format:'ansi'})`.
//
// Kept as a thin adapter so the engine stays substrate-unaware — the
// engine.ts Phase 0 contract is intact, callers just compose:
//
//   const source = await createPaneSource({ paneId, windowId });
//   capture({ target: {kind:'pane', paneId}, format: 'png', source });
//
// Returning the source as an async closure (fetches snapshot on each
// invocation) keeps the surface flexible: a caller that wants a live
// asciicast recording can call source() repeatedly as the pane
// evolves; a one-shot Screenshot only calls once.
//
// See: 내부 문서 `PLAN-session-capture-phase-0` §9 (next-phase integration)
//      내부 문서 `CAPABILITIES-capture-engine` §9.3

import { getDefaultPaneFactory } from '../../panes/factory.js';
import type { Pane, PaneRef } from '../../panes/types.js';

export interface PaneSourceOpts {
  readonly windowId: string;
  readonly paneId: string;
  readonly runnerLabel?: string;
  /** Factory override — otherwise uses `getDefaultPaneFactory()`.
   *  Injectable for tests that want an isolated PaneFactory. */
  readonly factory?: { peek(ref: PaneRef): Pane | undefined };
}

/** Error raised when a pane cannot be resolved against the factory. */
export class PaneSourceNotFoundError extends Error {
  constructor(public readonly ref: PaneRef) {
    super(`pane not found for ref ${ref.windowId}::${ref.paneId}`);
    this.name = 'PaneSourceNotFoundError';
  }
}

/** Build a caller-friendly ref. Centralized so the format stays in one
 *  place across the capture-tools stack. */
export function paneRefOf(opts: PaneSourceOpts): PaneRef {
  return {
    windowId: opts.windowId,
    paneId: opts.paneId,
    ...(opts.runnerLabel !== undefined ? { runnerLabel: opts.runnerLabel } : {}),
  };
}

/** Try to look up a pane without instantiating one. Returns undefined
 *  when the factory hasn't yet seen this ref — callers can decide
 *  whether to spawn or surface a "pane not yet ready" error. */
export function lookupPane(opts: PaneSourceOpts): Pane | undefined {
  const factory = opts.factory ?? getDefaultPaneFactory();
  return factory.peek(paneRefOf(opts));
}

/** Create an async source closure for the capture engine. Each call
 *  fetches the current ANSI snapshot from the pane; a missing pane
 *  throws `PaneSourceNotFoundError`. */
export function createPaneSource(
  opts: PaneSourceOpts,
): () => Promise<string> {
  return async () => {
    const pane = lookupPane(opts);
    if (!pane) throw new PaneSourceNotFoundError(paneRefOf(opts));
    const snap = await pane.snapshot({ format: 'ansi' });
    return snap.ansi ?? '';
  };
}

/** Synchronous variant for paths that already have a Pane reference in
 *  hand (dashboard composer, test harness). Wraps the async snapshot
 *  with a pre-computed call so the engine's sync `capture()` path stays
 *  usable. */
export async function resolvePaneAnsi(opts: PaneSourceOpts): Promise<string> {
  const pane = lookupPane(opts);
  if (!pane) throw new PaneSourceNotFoundError(paneRefOf(opts));
  const snap = await pane.snapshot({ format: 'ansi' });
  return snap.ansi ?? '';
}

/** Describe helper — returns the pane's describe() payload or undefined.
 *  Backs the InspectPane LLM tool without forcing the engine path. */
export function describePane(opts: PaneSourceOpts) {
  const pane = lookupPane(opts);
  return pane?.describe();
}
