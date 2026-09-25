// ── widget-based AskUserQuestionResolver factory ──
//
// LT 6 follow-up. The pure mapping in `ask-user.ts` left the host wire
// reserved; this factory closes it by composing:
//
//   AskUserQuestionRequest
//     → askUserRequestToInteractiveModalSpec
//       → runInteractiveModalSession({ spec, host })
//         → interactiveModalResultToAnswer
//           → AskUserQuestionResult
//
// Hosts (skill runner, ACP bridge, headless test harness, future
// dashboard pane that retires the bespoke modal) call:
//
//     setAskUserQuestionResolver(createWidgetAskUserResolver({
//       hostFactory: () => createNodeReadlineHost(process.stdin),
//     }));
//
// Each request gets a fresh host so the resolver never leaks readline
// state across calls. The dashboard's existing `createAskUserQuestion
// Modal` path stays untouched — hosts that don't opt in see no change.

import type { ReadlineHost } from '../readline-host.js';
import type { AskUserQuestionResolver } from '../../../ask-user-question/tool.js';
import type {
  AskUserQuestionRequest,
  AskUserQuestionResult,
} from '../../../ask-user-question/types.js';
import { runInteractiveModalSession } from '../interactive-modal.js';
import {
  askUserRequestToInteractiveModalSpec,
  interactiveModalResultToAnswer,
  type AskUserAdapterOpts,
} from './ask-user.js';

export interface CreateWidgetAskUserResolverOpts extends AskUserAdapterOpts {
  /** Per-request host factory. Returning a new host each call keeps
    *  the resolver stateless — readline listeners are released as soon
    *  as the session resolves (success OR cancel). */
  hostFactory: (req: AskUserQuestionRequest) => ReadlineHost;
  /** Finite wait for an unattended host; expiration resolves as cancelled. */
  timeoutMs?: number;
}

/** Build an `AskUserQuestionResolver` that drives the prompt through
 *  the expression widget substrate. */
export function createWidgetAskUserResolver(
  opts: CreateWidgetAskUserResolverOpts,
): AskUserQuestionResolver {
  const { hostFactory, timeoutMs, ...adapterOpts } = opts;
  return async (req): Promise<AskUserQuestionResult> => {
    const spec = askUserRequestToInteractiveModalSpec(req, adapterOpts);
    const host = hostFactory(req);
    const session = runInteractiveModalSession({ spec, host });
    if (timeoutMs === undefined) {
      return interactiveModalResultToAnswer(req, await session);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<AskUserQuestionResult>((resolve) => {
      timer = setTimeout(() => {
        resolve({ answers: {}, cancelled: true });
        queueMicrotask(() => host.close());
      }, timeoutMs);
      (timer as unknown as { unref?: () => void }).unref?.();
    });
    try {
      return await Promise.race([
        session.then((result) => interactiveModalResultToAnswer(req, result)),
        timeout,
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}
