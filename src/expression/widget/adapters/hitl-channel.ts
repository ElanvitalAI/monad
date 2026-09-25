// ── widget-based ConfirmChannel factory ──
//
// LT 6 follow-up. Mirrors `ask-user-resolver.ts` for the HITL side:
// composes the pure adapter in `hitl-confirm.ts` with `runInteractive
// ModalSession` so a host can register a ConfirmChannel that routes
// through the expression widget substrate without re-implementing the
// terminal modal.
//
// The default channel `name` is `'widget'` — distinct from `'terminal'`
// so a host can run them side-by-side during cutover (legacy terminal
// channel + new widget channel race; whichever answers first wins).
// Plugin host `requestConfirmation()` flows through this naturally
// once the channel is registered, so no separate plugin-host PR is
// required.
//
// The factory holds a per-instance `pendingCancel` reference so
// `channel.cancel()` (called by the multi-channel race when another
// channel wins first) settles the in-flight request immediately and
// closes the underlying host. The session promise becomes orphaned
// in that path — closing a `ReadlineHost` from the outside doesn't
// drive the modal state machine to `cancel`, so we resolve at the
// channel layer (HITL contract: any non-affirmative settlement,
// including external cancel, maps to `false`). `host.close()` is
// idempotent, so the runtime's own done/cancel cleanup never
// double-frees if the natural settlement happens first.

import type { ReadlineHost } from '../readline-host.js';
import type {
  ConfirmChannel,
  ConfirmRequest,
  HitlAnswer,
  HitlChannelName,
} from '../../../hitl/types.js';
import { runInteractiveModalSession } from '../interactive-modal.js';
import {
  hitlConfirmRequestToInteractiveModalSpec,
  interactiveModalResultToHitlConfirm,
  type HitlConfirmAdapterOpts,
} from './hitl-confirm.js';

export interface CreateWidgetHitlChannelOpts extends HitlConfirmAdapterOpts {
  /** Per-request host factory. Same contract as the ask-user resolver
   *  — fresh host per call so cancellation can dispose without
   *  affecting any future request. */
  hostFactory: (req: ConfirmRequest) => ReadlineHost;
  /** Channel name surfaced via `ConfirmResult.channel`. Defaults to
   *  `'widget'`. Cast to `HitlChannelName` so hosts can pick a
   *  pre-existing literal (`'terminal'`) when they want to *replace*
   *  the legacy channel rather than race alongside it. */
  name?: HitlChannelName;
}

/** Build a `ConfirmChannel` that routes HITL approval through the
 *  expression widget substrate. Register via:
 *
 *      registerDefaultConfirmChannels([
 *        createWidgetHitlChannel({ hostFactory: ... }),
 *        // ...other channels (telegram, discord) stay as-is
 *      ]);
 */
export function createWidgetHitlChannel(
  opts: CreateWidgetHitlChannelOpts,
): ConfirmChannel {
  const { hostFactory, name = 'widget', ...adapterOpts } = opts;
  let pendingCancel: (() => void) | null = null;
  return {
    name,
    request(req): Promise<HitlAnswer | null> {
      const start = Date.now();
      const spec = hitlConfirmRequestToInteractiveModalSpec(req, adapterOpts);
      const host = hostFactory(req);
      return new Promise<HitlAnswer | null>((resolve) => {
        let settled = false;
        const settle = (answer: HitlAnswer | null) => {
          if (settled) return;
          settled = true;
          pendingCancel = null;
          resolve(answer);
        };
        pendingCancel = () => {
          try { host.close(); } catch { /* idempotent */ }
          settle(false);
        };
        runInteractiveModalSession({ spec, host }).then(
          (modalResult) => {
            const elapsedMs = Date.now() - start;
            settle(interactiveModalResultToHitlConfirm(modalResult, elapsedMs).answer);
          },
          () => settle(false),
        );
      });
    },
    cancel() {
      if (pendingCancel) {
        try { pendingCancel(); } catch { /* best-effort */ }
      }
    },
  };
}
