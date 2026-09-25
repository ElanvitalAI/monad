// ── ACP ask-user-question ↔ InteractiveModal adapter ──
//
// LT 6 of the expression Quick Win arc · part of the bidirectional-
// integrations PR. Converts an AskUserQuestionRequest (1–3 LLM-driven
// Q&A items, each with options + optional Other-text + multi-select)
// into an InteractiveModalSpec the widget framework can drive, and
// translates the resulting answers back into the ACP-shaped
// AskUserQuestionResult.
//
// The adapter is a *pure* mapping — it does NOT run the modal itself.
// Callers (dashboard host, future plugin host, ACP delivery resolver)
// pass the spec to `runInteractiveModalSession()` and feed the result
// back through `interactiveModalResultToAnswer()` to get the shape the
// LLM expects.
//
// Why an adapter instead of a direct rewrite of `src/ask-user-question/
// modal.ts`? The legacy dashboard modal is well-tested and battle-
// hardened across the past arcs — replacing it wholesale risks paint
// regressions in the hottest UI surface. The adapter lets a host opt
// into the new substrate by:
//   1. Importing this file.
//   2. Building a spec via `askUserRequestToInteractiveModalSpec`.
//   3. Calling `runInteractiveModalSession({ spec, host })`.
//   4. Translating the result with `interactiveModalResultToAnswer`.
// Hosts that don't opt in keep the legacy `createAskUserQuestionModal`
// path untouched.

import type {
  AskUserQuestionRequest,
  AskUserQuestionResult,
  Question,
} from '../../../ask-user-question/types.js';
import type {
  InteractiveModalSpec,
  InteractiveModalStep,
  PickerStepSpec,
  TextStepSpec,
} from '../../spec/types.js';
import type { InteractiveModalResult } from '../interactive-modal.js';

/** The Other-option suffix the modal appends when `includeOther` is
 *  true (default) and we want the user to escape the canned options. */
export const OTHER_LABEL = 'Other';
export const OTHER_TEXT_FIELD_SUFFIX = '__other_text';

export interface AskUserAdapterOpts {
  /** Modal id used for log + restoration. Defaults to a synthesized
   *  string from the request's question count + first header. */
  id?: string;
  /** Optional title — falls back to the first question's header
   *  (truncated to ≤ 12 chars by ACP rules) or `'AskUserQuestion'`. */
  title?: string;
  /** Optional summary line shown beneath the title — the dashboard
   *  modal uses the first question's natural-language `question` text;
   *  surfaces with their own header bar can pass `''` to suppress. */
  excerpt?: string;
}

/** Convert an `AskUserQuestionRequest` into an `InteractiveModalSpec`.
 *  Each Question becomes one (or two) modal steps:
 *    - The picker step lists the canned options + an `Other` entry
 *      when `includeOther !== false`.
 *    - When the picker selects `Other`, the modal chains into a free-
 *      form text step keyed `<questionId>__other_text`.
 *  Multi-select questions are emitted with `multi: true`. */
export function askUserRequestToInteractiveModalSpec(
  req: AskUserQuestionRequest,
  opts: AskUserAdapterOpts = {},
): InteractiveModalSpec {
  if (!Array.isArray(req.questions) || req.questions.length === 0) {
    throw new Error('askUserRequestToInteractiveModalSpec: at least one question required.');
  }

  const steps: InteractiveModalStep[] = [];
  for (const q of req.questions) {
    steps.push(toPickerStep(q));
    if (q.includeOther !== false) {
      steps.push(toOtherTextStep(q));
    }
  }

  const id = opts.id ?? `ask-user-${req.questions.length}-${req.questions[0].id}`;
  const title = opts.title ?? defaultTitle(req.questions[0]);
  const excerpt = opts.excerpt !== undefined ? opts.excerpt : req.questions[0].question;

  const spec: InteractiveModalSpec = {
    kind: 'interactive-modal',
    id,
    title,
    steps,
    schema_version: 1,
  };
  if (excerpt && excerpt.length > 0) {
    (spec as { excerpt?: string }).excerpt = excerpt;
  }
  return spec;
}

function toPickerStep(q: Question): PickerStepSpec {
  const items = q.options.map((o, i) => ({
    id: `${q.id}__opt${i}`,
    label: o.label,
    description: o.description,
  }));
  if (q.includeOther !== false) {
    items.push({ id: `${q.id}__other`, label: OTHER_LABEL, description: 'Type your own answer' });
  }
  const step: PickerStepSpec = {
    kind: 'pick',
    id: q.id,
    label: q.question,
    items,
  };
  if (q.multiSelect) (step as { multi?: boolean }).multi = true;
  return step;
}

function toOtherTextStep(q: Question): TextStepSpec {
  return {
    kind: 'text',
    id: `${q.id}${OTHER_TEXT_FIELD_SUFFIX}`,
    label: `${q.header} — Other`,
    help: 'This step is skipped when "Other" is not selected.',
  };
}

function defaultTitle(q: Question): string {
  return q.header && q.header.length > 0 ? q.header : 'AskUserQuestion';
}

/** Translate the modal's answer record back into the ACP shape the
 *  LLM tool expects.
 *
 *  Picker selections come back as the option *id* (`<qid>__optN` or
 *  `<qid>__other`); the adapter resolves them back to the human-
 *  readable label via the original request. Multi-select picker
 *  answers arrive as `string[]`. The Other text step is folded into
 *  `otherText[questionId]` only when its `__other` option was
 *  actually picked.
 *
 *  Cancellations propagate as `{ cancelled: true }` plus any answers
 *  that were collected before Esc. */
export function interactiveModalResultToAnswer(
  req: AskUserQuestionRequest,
  modalResult: InteractiveModalResult,
): AskUserQuestionResult {
  const answers: Record<string, string | string[]> = {};
  const otherText: Record<string, string> = {};

  for (const q of req.questions) {
    const picked = modalResult.answers[q.id];
    if (picked === undefined || picked === null) continue;

    if (q.multiSelect) {
      const ids = Array.isArray(picked) ? picked : [String(picked)];
      const labels = ids.map((id) => optionIdToLabel(q, String(id)));
      answers[q.id] = labels;
    } else {
      const id = Array.isArray(picked) ? String(picked[0] ?? '') : String(picked);
      answers[q.id] = optionIdToLabel(q, id);
    }

    if (q.includeOther !== false) {
      const otherIdMatch = matchedOther(q, picked);
      if (otherIdMatch) {
        const free = modalResult.answers[`${q.id}${OTHER_TEXT_FIELD_SUFFIX}`];
        if (typeof free === 'string' && free.length > 0) {
          otherText[q.id] = free;
        }
      }
    }
  }

  const result: AskUserQuestionResult = { answers };
  if (Object.keys(otherText).length > 0) result.otherText = otherText;
  if (modalResult.status === 'cancel') {
    result.cancelled = true;
  }
  // ⭐ 취소여도 «답이 있었으면» 사람이 답한 것이다 — 취소를 이유로 provenance 를 버리면
  //    「아무도 안 답했다」가 거짓이 된다(무인 리뷰 R5). ⛔ 답이 0개면 기록하지 않는다.
  if (Object.keys(result.answers).length > 0) result.answeredBy = 'human';
  return result;
}

function optionIdToLabel(q: Question, id: string): string {
  if (id === `${q.id}__other`) return OTHER_LABEL;
  const match = id.match(/^.+__opt(\d+)$/);
  if (match) {
    const idx = parseInt(match[1], 10);
    if (Number.isFinite(idx) && idx >= 0 && idx < q.options.length) {
      return q.options[idx].label;
    }
  }
  // Defensive — unknown option id falls through as the raw string so
  // the LLM can at least see *what* was returned rather than ''.
  return id;
}

function matchedOther(q: Question, picked: unknown): boolean {
  const otherId = `${q.id}__other`;
  if (Array.isArray(picked)) return picked.some((v) => String(v) === otherId);
  return String(picked) === otherId;
}
