// ── HITL `ConfirmRequest` ↔ InteractiveModal adapter ──
//
// LT 6 of expression Quick Win arc. Translates a HITL `ConfirmRequest`
// (yes/no with optional detail + custom labels) into a single-step
// `InteractiveModalSpec`, and unpacks the resulting modal answer into
// the boolean shape `requestConfirmation` callers expect.
//
// The pattern mirrors `ask-user.ts`: pure mapping in both directions,
// no IO, no host coupling. Hosts plug the adapter into their own
// `ConfirmChannel` impl when they want to route HITL approval through
// the expression widget substrate (e.g., a dashboard pane that hosts
// confirm + ask-user under the same modal frame).
//
// HITL's existing telegram / discord / pushcut channels stay untouched
// — those are remote-delivery surfaces and would not benefit from a
// terminal widget. The adapter is for the `terminal` channel and any
// future in-process modal channel.

import type { ConfirmRequest, ConfirmResult } from '../../../hitl/types.js';
import type {
  ConfirmStepSpec,
  InteractiveModalSpec,
} from '../../spec/types.js';
import type { InteractiveModalResult } from '../interactive-modal.js';

export interface HitlConfirmAdapterOpts {
  /** Modal id used for log / restoration. Defaults to
   *  `hitl-confirm-<requestId|prompt-hash>`. */
  id?: string;
  /** Optional title — defaults to `'Approval required'`. */
  title?: string;
}

const DEFAULT_TITLE = 'Approval required';
const DEFAULT_YES = 'Yes';
const DEFAULT_NO = 'No';
const STEP_ID = 'hitl_approval';

/** Convert a `ConfirmRequest` into a single-step `InteractiveModalSpec`.
 *  The yes / no labels become hint text on the confirm step; the
 *  request's `prompt` is the step label and `detail` is the modal
 *  excerpt. `requestId` propagates as the modal id when supplied so
 *  log lines stay correlated with the upstream caller's trace. */
export function hitlConfirmRequestToInteractiveModalSpec(
  req: ConfirmRequest,
  opts: HitlConfirmAdapterOpts = {},
): InteractiveModalSpec {
  const id = opts.id ?? (req.requestId ? `hitl-confirm-${req.requestId}` : `hitl-confirm-${hashPrompt(req.prompt)}`);
  const title = opts.title ?? DEFAULT_TITLE;
  const yes = req.yesLabel ?? DEFAULT_YES;
  const no = req.noLabel ?? DEFAULT_NO;
  const step: ConfirmStepSpec = {
    kind: 'confirm',
    id: STEP_ID,
    label: req.prompt,
    help: `${yes} / ${no}`,
    default: false,
  };
  const spec: InteractiveModalSpec = {
    kind: 'interactive-modal',
    id,
    title,
    steps: [step],
    schema_version: 1,
  };
  if (req.detail && req.detail.length > 0) {
    (spec as { excerpt?: string }).excerpt = req.detail;
  }
  return spec;
}

/** Translate the modal's result back into a HITL boolean.
 *
 *  Cancellation maps to `false` — the existing `requestConfirmation`
 *  contract treats every non-affirmative response (timeout / refused /
 *  channel error) as "not approved". `channel` is fixed to
 *  `'terminal'` here since this adapter only powers the in-process
 *  surface; remote channels (telegram / discord) keep their own
 *  resolvers and never go through this path. */
export function interactiveModalResultToHitlConfirm(
  modalResult: InteractiveModalResult,
  elapsedMs: number,
): ConfirmResult {
  if (modalResult.status === 'cancel') {
    return { answer: false, channel: 'terminal', elapsedMs };
  }
  const raw = modalResult.answers[STEP_ID];
  const answer = raw === true || raw === 'true' || raw === 'y' || raw === 'yes';
  return { answer, channel: 'terminal', elapsedMs };
}

// Cheap stable hash so two confirms on the same prompt within one
// second collide (acceptable — log dedup, not security). Avoids
// pulling in node:crypto for what is effectively a debug-line label.
function hashPrompt(prompt: string): string {
  let h = 0;
  for (let i = 0; i < prompt.length; i++) {
    h = (h * 31 + prompt.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36).slice(0, 6);
}
