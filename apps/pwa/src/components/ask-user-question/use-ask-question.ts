// use-ask-question.ts — Bridge between the daemon's `monad/ask/*`
// extMethod and the React tree. M4 of PLAN-ask-user-question-cross-
// surface-2026-05-13.
//
// Registers an `acp.onRequest('monad/ask/request', …)` handler that
// stashes the inbound request in component state, then suspends on a
// Promise. AskQuestionSheet renders from that state; its Submit /
// Cancel callbacks resolve the suspended Promise so the daemon's
// `sendRequest` gets the AskUserQuestionResult back as the JSON-RPC
// result.
//
// Composer prefill ("Chat about this" outlet) is exposed via the
// `onComposerPrefill` callback so the embedding ChatLayout decides
// how to focus + populate its input field.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AcpConnection } from '@/lib/daemon-client';
import {
  MONAD_ASK_CANCEL_METHOD,
  MONAD_ASK_REQUEST_METHOD,
  parseMonadAskCancelPayload,
  parseMonadAskRequestPayload,
  type AskUserQuestionRequest,
  type AskUserQuestionResult,
} from '@/lib/monad-ask-extensions';

export interface UseAskQuestionResult {
  /** Currently displayed request (or null when idle). AskQuestionSheet
   *  binds this to `<Dialog open={request !== null} />` semantics. */
  pendingRequest: AskUserQuestionRequest | null;
  /** Submit handler the sheet calls. Resolves the suspended daemon
   *  request with the user's answers. */
  submit: (result: AskUserQuestionResult) => void;
  /** Cancel handler. Same wire as "Chat about this" — `cancelled: true`. */
  cancel: () => void;
  /** "Chat about this" handler. Cancels the wire AND fires the
   *  composer-prefill callback so the parent ChatLayout can focus +
   *  populate its input with a quoted question prefix. */
  chatAboutThis: () => void;
}

export interface UseAskQuestionOpts {
  acp: AcpConnection | null;
  /** Called when the user clicks "Chat about this". Parent gets the
   *  request payload to build a quoted-prefix string (e.g.
   *  `[ Q: <question> ]\n\n`) and focus its composer. */
  onComposerPrefill?: (req: AskUserQuestionRequest) => void;
}

interface PendingState {
  request: AskUserQuestionRequest;
  /** Resolve hook the daemon-side handler is suspended on. Called from
   *  Submit / Cancel / "Chat about this". Cleared after one fire (one-
   *  shot guard against double-submit). */
  resolve: (result: AskUserQuestionResult) => void;
  /** Server-pushed correlation id — used to match cancel notifications. */
  askId: string;
}

export function useAskQuestion({ acp, onComposerPrefill }: UseAskQuestionOpts): UseAskQuestionResult {
  const [pending, setPending] = useState<PendingState | null>(null);
  // Ref mirror so handlers registered to acp don't capture a stale
  // setState — React's batching can otherwise drop a fast-arriving
  // cancel between request handle and state commit.
  const pendingRef = useRef<PendingState | null>(null);

  const commit = useCallback((next: PendingState | null) => {
    pendingRef.current = next;
    setPending(next);
  }, []);

  const finish = useCallback(
    (result: AskUserQuestionResult) => {
      const current = pendingRef.current;
      if (!current) return;
      current.resolve(result);
      commit(null);
    },
    [commit],
  );

  // Register / unregister the request + cancel handlers when the
  // AcpConnection changes (e.g. reconnect after a transport failure).
  useEffect(() => {
    if (!acp) return undefined;

    const offRequest = acp.onRequest(MONAD_ASK_REQUEST_METHOD, async (rawParams) => {
      const payload = parseMonadAskRequestPayload(rawParams);
      if (!payload) {
        // Bad shape → respond with a cancelled-degrade so the daemon
        // doesn't wedge. Throwing here would surface as -32603 internal
        // error, which is fine but less helpful for the LLM.
        return { answers: {}, cancelled: true } satisfies AskUserQuestionResult;
      }
      // Replace any stale pending (defensive — daemon's bridge ensures
      // one-at-a-time per session).
      const stale = pendingRef.current;
      if (stale) {
        stale.resolve({ answers: {}, cancelled: true });
      }
      return await new Promise<AskUserQuestionResult>((resolve) => {
        commit({ request: payload.request, resolve, askId: payload.id });
      });
    });

    const offCancel = acp.on('sessionUpdate', () => {
      // We don't piggyback on sessionUpdate for cancels; the daemon
      // sends them as JSON-RPC notifications, which arrive via the
      // notification path (not requestHandlers). We do nothing here —
      // the proper cancel hook is registered below via `onAny`.
    });

    // Cancel notifications arrive as `{ jsonrpc, method: 'monad/ask/
    // cancel', params }` with no id. The `onAny` hook catches every
    // inbound frame; we filter by method.
    const offAny = acp.onAny((frame) => {
      if (frame.method !== MONAD_ASK_CANCEL_METHOD) return;
      if (frame.id !== undefined) return;   // requests handled elsewhere
      const cancel = parseMonadAskCancelPayload(frame.params);
      if (!cancel) return;
      const current = pendingRef.current;
      if (!current || current.askId !== cancel.id) return;
      finish({ answers: {}, cancelled: true });
    });

    return () => {
      offRequest();
      offCancel();
      offAny();
      // If the connection is being torn down with an open sheet, resolve
      // it as cancelled so the daemon doesn't hang.
      const current = pendingRef.current;
      if (current) {
        current.resolve({ answers: {}, cancelled: true });
        pendingRef.current = null;
      }
    };
  }, [acp, commit, finish]);

  const submit = useCallback(
    (result: AskUserQuestionResult) => {
      finish(result);
    },
    [finish],
  );

  const cancel = useCallback(() => {
    finish({ answers: {}, cancelled: true });
  }, [finish]);

  const chatAboutThis = useCallback(() => {
    const current = pendingRef.current;
    if (current && onComposerPrefill) {
      onComposerPrefill(current.request);
    }
    finish({ answers: {}, cancelled: true });
  }, [finish, onComposerPrefill]);

  return {
    pendingRequest: pending?.request ?? null,
    submit,
    cancel,
    chatAboutThis,
  };
}
