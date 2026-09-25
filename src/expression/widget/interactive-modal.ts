// InteractiveModalSession — drives a Q&A chain over an injected
// `ReadlineHost`. The class glues:
//
//   - `state-machine.ts` (6-state machine)
//   - `key-route.ts`     (pure key → action)
//   - `readline-host.ts` (input pump abstraction)
//   - `spec/types.ts`    (`InteractiveModalSpec` + steps)
//
// The session is host-agnostic: a setup wizard process can drive it
// via `createNodeReadlineHost()`, and the dashboard widget path
// (follow-up PR) drives the same session via a routed-key host.
// Both paths share the same spec, so `monad setup` and
// `/setup` host-side render the identical Q&A chain.
//
// Validation is per-step. A failed validation transitions the
// machine `awaiting → answered → reject → awaiting` and the session
// surfaces the rejection reason via `onProgress` for the renderer
// (next mini-PR) to display inline.

import type {
  InteractiveModalSpec,
  InteractiveModalStep,
} from '../spec/types.js';
import { exprDebug } from '../debug.js';
import {
  INITIAL_SNAPSHOT,
  transition,
  type ModalSessionEvent,
  type ModalSessionSnapshot,
} from './state-machine.js';
import type { ReadlineHost } from './readline-host.js';

export interface InteractiveModalProgress {
  /** Index of the step that produced this update. */
  stepIndex: number;
  step: InteractiveModalStep;
  snapshot: ModalSessionSnapshot;
  /** Validation error from the most recent reject, when relevant. */
  rejectReason?: string;
}

export interface InteractiveModalLifecycle {
  /** Called once after the session attaches to the host but before
   *  the first step is rendered. Allocate any resources here. */
  onMount?(): void;
  /** Called whenever the snapshot changes. Renderers subscribe via
   *  `onProgress` for fine-grained updates; `onSnapshot` is the
   *  catch-all "something changed" hook. */
  onSnapshot?(snapshot: ModalSessionSnapshot): void;
  /** Called once after the session terminates (done OR cancel) and
   *  the host is closed. MUST be idempotent. */
  onUnmount?(): void;
}

export interface InteractiveModalRunOpts {
  spec: InteractiveModalSpec;
  host: ReadlineHost;
  lifecycle?: InteractiveModalLifecycle;
  /** Per-step progress callback. Renderers use this to refresh the
   *  on-screen prompt and surface validation feedback. */
  onProgress?(p: InteractiveModalProgress): void;
}

export interface InteractiveModalResult {
  /** Final state — `done` for normal completion, `cancel` for user
   *  abort. */
  status: 'done' | 'cancel';
  /** Answers keyed by `step.id`. Always present, even on cancel
   *  (partial chain). */
  answers: Record<string, unknown>;
  /** Reason supplied with the cancel event, when applicable. */
  cancelReason?: string;
}

/** Drive an InteractiveModalSpec to completion over the given host.
 *  Returns a Promise that resolves with the aggregated answers. */
export function runInteractiveModalSession(
  opts: InteractiveModalRunOpts,
): Promise<InteractiveModalResult> {
  const { spec, host, lifecycle, onProgress } = opts;
  return new Promise<InteractiveModalResult>((resolve) => {
    const answers: Record<string, unknown> = {};
    let snapshot: ModalSessionSnapshot = INITIAL_SNAPSHOT;
    let stepIndex = 0;
    let rejectReason: string | undefined;
    let resolved = false;
    let unsubscribe: (() => void) | null = null;

    const cleanup = () => {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      try {
        host.close();
      } catch { /* idempotent */ }
      lifecycle?.onUnmount?.();
    };

    const finish = (result: InteractiveModalResult) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(result);
    };

    const dispatch = (ev: ModalSessionEvent) => {
      const next = transition(snapshot, ev);
      if (!next) {
        exprDebug('widget.interactive-modal', 'event-rejected', {
          state: snapshot.state,
          eventKind: ev.kind,
        });
        return;
      }
      snapshot = next;
      lifecycle?.onSnapshot?.(snapshot);
      onProgress?.({
        stepIndex,
        step: spec.steps[stepIndex]!,
        snapshot,
        rejectReason: snapshot.state === 'awaiting' ? rejectReason : undefined,
      });
      exprDebug('widget.interactive-modal', 'transition', {
        eventKind: ev.kind,
        state: snapshot.state,
        stepIndex,
      });

      // Drive the chain forward when a step is accepted.
      if (snapshot.state === 'chained') {
        const step = spec.steps[stepIndex]!;
        answers[step.id] = snapshot.pendingAnswer;
        rejectReason = undefined;
        if (stepIndex + 1 >= spec.steps.length) {
          dispatch({ kind: 'finish' });
          return;
        }
        stepIndex += 1;
        dispatch({ kind: 'next' });
        dispatch({ kind: 'await' });
        return;
      }

      if (snapshot.state === 'show') {
        // First step — pump immediately.
        dispatch({ kind: 'await' });
        return;
      }

      if (snapshot.state === 'done') {
        finish({ status: 'done', answers });
        return;
      }

      if (snapshot.state === 'cancel') {
        finish({
          status: 'cancel',
          answers,
          cancelReason: snapshot.reason,
        });
      }
    };

    // Wire up input listener BEFORE mount so the very first event
    // (a synchronous test host's pre-recorded line) lands.
    unsubscribe = host.on((event) => {
      if (resolved) return;
      const step = spec.steps[stepIndex];
      if (!step) return;
      if (event.kind === 'line') {
        const value = event.value;
        const validation = validateStep(step, value);
        if (validation.ok) {
          dispatch({ kind: 'answer', value: validation.value });
          dispatch({ kind: 'accept' });
        } else {
          dispatch({ kind: 'answer', value });
          rejectReason = validation.reason;
          dispatch({ kind: 'reject', reason: validation.reason });
        }
        return;
      }
      // Key events — currently we just route Esc / Ctrl-C to cancel
      // for a line-based host. Full key navigation lives in the
      // dashboard widget path follow-up.
      if (event.kind === 'key') {
        const k = event.key;
        if (k.name === 'escape' || (k.name === 'c' && k.ctrl)) {
          dispatch({ kind: 'cancel', reason: 'user' });
        }
      }
    });

    lifecycle?.onMount?.();
    dispatch({ kind: 'mount' });
  });
}

interface ValidationResult {
  ok: boolean;
  value: unknown;
  reason: string;
}

function validateStep(step: InteractiveModalStep, raw: string): ValidationResult {
  if (step.kind === 'confirm') {
    const trimmed = raw.trim().toLowerCase();
    if (trimmed === '' && typeof step.default === 'boolean') {
      return { ok: true, value: step.default, reason: '' };
    }
    if (['y', 'yes', 'true', '1'].includes(trimmed)) {
      return { ok: true, value: true, reason: '' };
    }
    if (['n', 'no', 'false', '0'].includes(trimmed)) {
      return { ok: true, value: false, reason: '' };
    }
    return { ok: false, value: raw, reason: 'expected y/n' };
  }

  if (step.kind === 'text') {
    if (raw === '' && typeof step.default === 'string') {
      return { ok: true, value: step.default, reason: '' };
    }
    if (step.validate?.pattern) {
      const re = safeRegExp(step.validate.pattern);
      if (re && !re.test(raw)) {
        return {
          ok: false,
          value: raw,
          reason: step.validate.message ?? 'value does not match expected pattern',
        };
      }
    }
    return { ok: true, value: raw, reason: '' };
  }

  if (step.kind === 'pick') {
    const trimmed = raw.trim();
    if (trimmed === '' && step.default) {
      return { ok: true, value: step.default, reason: '' };
    }
    const matched = step.items.find((it) => it.id === trimmed || it.label === trimmed);
    if (!matched) {
      return {
        ok: false,
        value: raw,
        reason: `must be one of: ${step.items.map((i) => i.id).join(', ')}`,
      };
    }
    return { ok: true, value: matched.id, reason: '' };
  }

  return { ok: true, value: raw, reason: '' };
}

function safeRegExp(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}
