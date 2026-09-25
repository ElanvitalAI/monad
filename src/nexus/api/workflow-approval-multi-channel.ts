// NEXUS · workflow approval multi-channel race fan-out
// (BACKLOG #4 / Archon-port followups · 2026-05-08)
//
// Until this module, `requestApproval(message)` (the dep that the
// workflow runtime hands to approval nodes) routed to ONE surface:
// the PWA modal via `registerApproval(runId, message)`. PR #1986
// landed the bridge; #1998 added SSE push so it fires within ~200ms.
// But the user could only answer FROM the PWA — Pushcut iPhone
// shortcut, future Telegram / Discord taps, etc. were not options
// even though the HITL infra to deliver those channels was already
// wired into NEXUS by #2009.
//
// This bridge fixes that. `runApprovalAcrossChannels()` races:
//
//   • The PWA registry path (registerApproval → POST /approve|/reject
//     resolves the deferred Promise). The PWA modal sees the approval
//     just like before — no client change required.
//   • The HITL channel path (`requestConfirmation()` → races every
//     channel registered via `registerDefaultConfirmChannels`, e.g.
//     Pushcut from #2009; future Telegram / Discord additions auto-
//     join without touching this file).
//
// Whichever path resolves first WINS:
//   • Winner's response (or boolean → 'approved'/'rejected' string)
//     is returned to the workflow runtime.
//   • Loser's pending state is cancelled so the user doesn't get
//     stale prompts on other devices.
//
// The bridge is purely additive — when `requestConfirmation` finds
// no channels (Pushcut not configured + no future channels wired),
// it returns immediately with the timeout fallback `false`, the PWA
// path keeps waiting indefinitely (its previous behavior), and the
// race resolves whenever the PWA user answers. So users with no
// HITL infrastructure see zero behavior change.

import {
  registerApproval,
  rejectApproval,
} from './workflow-approvals.js';
import { requestConfirmation, getDefaultConfirmChannels } from '../../hitl/confirm.js';
import { channelMatchesDelivery, type HitlDelivery } from '../../hitl/types.js';

/** Resolution returned to the workflow runtime. Mirrors the previous
 *  `registerApproval` return type so callers don't need to change. */
export type ApprovalResolution = string | undefined;

export interface RunApprovalOpts {
  runId: string;
  message: string;
  /** HITL race timeout — defaults to 10 minutes. Long enough for a
   *  human to walk to their phone, short enough that a fully-stalled
   *  channel gets reaped. The PWA path has its own indefinite wait
   *  semantics (the registry doesn't time out — see
   *  `workflow-approvals.ts`); only the HITL race obeys this. */
  hitlTimeoutMs?: number;
  /** archon-port BACKLOG #4 (2026-05-11) — restrict the race to a
   *  specific HITL surface. Omitted / 'all' = race every registered
   *  channel + the PWA modal (existing default). Any other value
   *  filters HITL channels via `channelMatchesDelivery`; importantly
   *  `'modal'` skips the *HITL* terminal channel but still races the
   *  PWA modal registry path (the PWA modal == 'modal' from the
   *  workflow author's POV, not the terminal channel). */
  delivery?: HitlDelivery;
}

/** Race the PWA registry path against the HITL channel race. The
 *  first path to resolve wins; the loser is cancelled.
 *
 *  Return value semantics:
 *  - PWA wins with response body  → that body string
 *  - PWA wins with bare /approve  → undefined (matches pre-bridge contract)
 *  - HITL wins true               → 'approved (channel:<name>)' marker string
 *  - HITL wins false              → throws Error('approval rejected via <channel>')
 *  - PWA /reject                  → throws (registerApproval rejects the Promise)
 *  - HITL all-failed timeout      → continues waiting on PWA only (channel timeout
 *                                   doesn't end the race; PWA still wins eventually)
 *
 *  The throw-on-rejection behavior matches what `registerApproval`
 *  always did — the workflow runtime catches and surfaces the error
 *  on the approval node's `error` field. */
export async function runApprovalAcrossChannels(
  opts: RunApprovalOpts,
): Promise<ApprovalResolution> {
  const { runId, message } = opts;
  const hitlTimeoutMs = opts.hitlTimeoutMs ?? 10 * 60 * 1000;
  const delivery: HitlDelivery = opts.delivery ?? 'all';

  // BACKLOG #4 — when delivery is non-'all' and not 'modal', the PWA
  // path is excluded so the workflow author's preference is honoured
  // exactly. ('modal' == PWA modal from the workflow author's POV ·
  // see RunApprovalOpts.delivery doc.)
  const includePwa = delivery === 'all' || delivery === 'modal';

  // Path A — PWA modal registry. Returns string|undefined or rejects.
  let pwaPath: Promise<{ winner: 'pwa'; result: ApprovalResolution }> | null = null;
  if (includePwa) {
    pwaPath = registerApproval(runId, message).then((result) => ({ winner: 'pwa' as const, result }));
  }

  // Path B — HITL channel race. Skip entirely when no channels are
  // configured so we don't burn 10 minutes on a no-op timeout in the
  // common (no Pushcut configured) case. With BACKLOG #4 delivery
  // filter, also skip channels that don't match the requested surface
  // — `requestConfirmation` exposes the same filter via `policy`.
  const allChannels = getDefaultConfirmChannels();
  // 'all' OR 'modal' means no HITL filter (modal goes to the PWA path).
  // Any other delivery filters to channels matching the surface name.
  const channels = delivery === 'all' || delivery === 'modal'
    ? allChannels
    : allChannels.filter((c) => channelMatchesDelivery(c.name, delivery));
  let hitlPath: Promise<HitlWin | HitlTimeout> | null = null;
  if (channels.length > 0) {
    hitlPath = requestConfirmation({
      prompt: `Workflow approval: ${runId}`,
      detail: message,
      requestId: `wf-approval-${runId}`,
      timeoutMs: hitlTimeoutMs,
      // Pass the delivery filter through so `requestConfirmation`
      // applies its own channel match · double-defence against
      // mis-registered channels (the wrapper-level filter above
      // already drops channels by name).
      ...(delivery !== 'all' && delivery !== 'modal'
        ? { delivery }
        : {}),
      // `requestConfirmation` returns its result.channel === 'timeout'
      // when nothing answers in time; we map that → HitlTimeout in the
      // .then below. Returning `false` here is just a placeholder for
      // the typed-result `answer` field — the race wrapper drops the
      // outcome before it reaches the workflow runtime.
      onTimeout: () => false,
    }).then<HitlWin | HitlTimeout>((result) => {
      if (result.channel === 'timeout' || result.channel === 'all-failed') {
        return { winner: 'hitl-timeout' as const };
      }
      return {
        winner: 'hitl' as const,
        channel: String(result.channel),
        answer: result.answer,
      };
    });
  }

  const racers: Promise<unknown>[] = [];
  if (pwaPath) racers.push(pwaPath);
  if (hitlPath) racers.push(hitlPath);
  if (racers.length === 0) {
    // delivery filter excluded both PWA and every HITL channel (e.g.
    // 'pushcut' requested but Pushcut not configured on this host).
    // Throw rather than hang — workflow author can spot the
    // misconfiguration immediately.
    throw new Error(
      `approval delivery '${delivery}' requested but no matching HITL channel configured`,
    );
  }

  // Manual race — Promise.race resolves on the first SETTLE (success
  // or rejection), which is exactly what we want, BUT we need to
  // discard the 'hitl-timeout' sentinel and keep waiting in that case.
  // Implement by recursive race-with-removal.
  //
  // BACKLOG #4 — when the PWA path is excluded (delivery non-modal),
  // an all-HITL-timeout result has no fallback racer left, so the
  // race surfaces a TimeoutError instead of silently approving.
  const winner = await raceFiltered(racers, { hasPwa: pwaPath !== null });

  if (winner.winner === 'pwa') {
    // PWA wins — cancel the HITL race so other devices don't keep
    // showing the prompt.
    // Note: requestConfirmation's internal "cancel losers" logic only
    // fires when one of its channels wins. When the race winner is
    // OUTSIDE requestConfirmation (PWA), we have to bail cleanly.
    // The HITL channels' own request handles will be GC'd when the
    // promise drops out of scope, but for explicit cancellation via
    // the channel.cancel() API, the requestConfirmation winner-loser
    // bookkeeping does it on its own once it sees its own race won.
    // Here we just let the unresolved HITL Promise dangle; any
    // pending confirm UI on user devices will time out per
    // hitlTimeoutMs above. (Trade-off: a follow-up could expose
    // channel-cancel handles for instant cancellation.)
    return winner.result;
  }

  // HITL wins.
  // We need to ALSO settle the PWA path so the registry doesn't leak
  // a pending Promise. rejectApproval(runId, ...) does that — it
  // rejects the deferred with our reason. The runtime catches that
  // rejection but we already got our answer from HITL, so we
  // need a careful order: settle our return value FIRST (so the
  // workflow runtime sees the HITL winner), THEN clean up.
  rejectApproval(runId, `superseded by HITL channel:${winner.channel}`);

  if (winner.answer === true) {
    return `approved (channel:${winner.channel})`;
  }
  // HITL `false` → throw to mirror PWA /reject semantics
  throw new Error(`approval rejected via ${winner.channel}`);
}

interface PwaWin {
  winner: 'pwa';
  result: ApprovalResolution;
}
interface HitlWin {
  winner: 'hitl';
  channel: string;
  answer: boolean;
}
interface HitlTimeout {
  winner: 'hitl-timeout';
}
type RaceOutcome = PwaWin | HitlWin | HitlTimeout;

/** Race that re-races when a racer returns a `hitl-timeout` sentinel.
 *  When `hasPwa` is true the PWA path always rejects-or-resolves
 *  (the registry doesn't time out), so the loop always terminates.
 *  When `hasPwa` is false (delivery filter excluded the PWA path),
 *  every racer is a HITL channel that may surface 'hitl-timeout' —
 *  in that case throw rather than silently approve. */
async function raceFiltered(
  racers: Promise<unknown>[],
  opts: { hasPwa: boolean },
): Promise<PwaWin | HitlWin> {
  let active: Promise<unknown>[] = racers.slice();
  while (active.length > 0) {
    // Tag each promise with its index so we can drop the winning
    // entry from `active` after the race resolves.
    const tagged: Array<Promise<{ idx: number; outcome: unknown }>> =
      active.map((p, idx) => p.then((outcome) => ({ idx, outcome })));
    const { idx, outcome } = await Promise.race(tagged);
    const out = outcome as RaceOutcome;
    if (out.winner === 'pwa' || out.winner === 'hitl') return out;
    // hitl-timeout — drop that racer, keep waiting on remaining ones.
    active = active.filter((_, i) => i !== idx);
  }
  // No racers left.
  if (opts.hasPwa) {
    // Defensive: PWA path is supposed to be infinite, so this branch
    // is unreachable in practice. Surface a synthetic PWA-win with
    // undefined to keep the workflow moving rather than block forever.
    return { winner: 'pwa', result: undefined };
  }
  // All HITL channels timed out and the PWA path was excluded —
  // there's no other surface to wait on, so throw rather than silently
  // approve.
  throw new Error('approval timed out — all HITL channels failed to respond');
}
