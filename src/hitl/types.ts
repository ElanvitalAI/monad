// AXON P4 — HITL public type surface.
//
// This module is the re-export hub for the types elanous code outside of
// src/hitl/ needs to talk about HITL. The runtime lives in confirm.ts
// (multi-channel race + default channels) and per-channel deps in
// telegram-channel.ts / discord-channel.ts. By collecting the types
// here we give consumers one import path and keep the implementation
// modules private.

export type {
  ConfirmChannel,
  ConfirmOpts,
  ConfirmRequest,
  ConfirmResult,
  DiscordConfirmDeps,
  HitlAnswer,
  HitlChannelName,
  PushcutConfirmDeps,
  TelegramConfirmDeps,
  TerminalConfirmDeps,
} from './confirm.js';

export type {
  ClarificationAction,
  ClarificationBudget,
  ClarificationCandidate,
  ClarificationContext,
  ClarificationDecision,
  ClarificationImpact,
  ClarificationPhase,
} from './clarification-policy.js';

/** Where a HITL prompt should be delivered. `'all'` fans out to every
 *  registered channel (the existing `requestConfirmation` default);
 *  the other values pre-filter channels by name so a task can say
 *  "ask on Telegram only" without unregistering the others. */
export type HitlDelivery = 'modal' | 'terminal' | 'telegram' | 'discord' | 'pushcut' | 'all';

/** Policy knobs every HITL entry point accepts. `delivery` is the
 *  scope filter; `timeoutMs` overrides `DEFAULT_TIMEOUT_MS`; `onTimeout`
 *  is the sync fallback (default: reject, return `false`). */
export interface HitlPolicy {
  delivery?: HitlDelivery;
  timeoutMs?: number;
  onTimeout?: () => boolean;
  /** L1 self-dev — fail-OPEN on unattended timeout/no-responder (opt-in,
   *  default OFF). Coding-tools-only by construction; the trade path
   *  never sets it. See `ConfirmOpts.failOpen` in `./confirm.ts`. */
  failOpen?: boolean;
}

/** Channel name → HitlDelivery mapping. `modal` and `terminal` both
 *  resolve to the terminal channel (modal being the more user-facing
 *  label); the rest are pass-through. */
export function channelMatchesDelivery(channelName: string, delivery: HitlDelivery): boolean {
  if (delivery === 'all') return true;
  if (delivery === 'modal' || delivery === 'terminal') {
    return channelName === 'terminal';
  }
  return channelName === delivery;
}
