// requestQuestion — multi-channel race for structured AskUserQuestion.
// M5 of PLAN-ask-user-question-cross-surface-2026-05-13.
//
// Sibling to `requestConfirmation` (src/hitl/confirm.ts) but carries
// the full `AskUserQuestionRequest` instead of a yes/no prompt. Channels
// run concurrently · Promise.race picks the winner · losing channels
// get cancel() called. Default timeout 120s.
//
// Why a separate function instead of widening `requestConfirmation`?
// • Different return shape (`AskUserQuestionResult` vs `boolean`).
// • Different wire — channels render N buttons / modal text input,
//   not Yes/No.
// • Channels not implementing the multi-option wire stay on the
//   confirm.ts path uninvolved.
//
// v1 (this PR) — interface + race orchestration only. Channel impls
// (Discord multi-button, Telegram inline keyboard, Pushcut deep-link)
// land as separate PRs. Until then, callers that previously used
// `createAcpQuestionApproverFromHitl` (yes/no collapse) get a
// structured "no channel installed" error — same UX as the yes/no
// degrade but with intent in the wire.

import type {
  AskUserQuestionRequest,
  AskUserQuestionResult,
} from '../ask-user-question/types.js';
import type { HitlChannelName } from './confirm.js';

export interface QuestionChannel {
  readonly name: HitlChannelName;
  /** Render the question on the channel's surface and resolve with the
   *  user's answer. Return `null` to indicate the channel isn't
   *  configured (caller drops it from the race). Throwing has the same
   *  effect — confirmed channels return a real result. */
  ask(req: AskUserQuestionRequest): Promise<AskUserQuestionResult | null>;
  /** Cancel the pending prompt on this channel. Called when another
   *  channel won the race so the user doesn't see a stale ask on
   *  multiple devices. No-op when nothing was pending. */
  cancel(): Promise<void> | void;
}

export interface RequestQuestionOpts {
  request: AskUserQuestionRequest;
  /** Channels to race. When omitted, callers get a structured "no
   *  channels" error so the LLM falls back to its default-and-note
   *  posture. */
  channels?: QuestionChannel[];
  /** Default 120_000 ms. Past this, every channel cancels and the
   *  fallback (default `{ answers: {}, cancelled: true }`) returns. */
  timeoutMs?: number;
  /** Override the timeout fallback. Default emits cancelled=true with
   *  no answers — matches `requestConfirmation`'s fail-closed posture. */
  onTimeout?: () => AskUserQuestionResult;
  /** Correlation tag included in channel ask() calls — useful for log
   *  joins. Channel impls may stash it in their wire id (Discord
   *  customId, Telegram callback_query data, etc.). */
  requestId?: string;
}

export interface RequestQuestionResult {
  result: AskUserQuestionResult;
  /** Channel that answered, or `'timeout'` / `'all-failed'`. */
  channel: HitlChannelName | 'timeout' | 'all-failed';
  elapsedMs: number;
}

export const DEFAULT_QUESTION_TIMEOUT_MS = 120_000;

let defaultChannels: QuestionChannel[] = [];

export function registerDefaultQuestionChannels(channels: QuestionChannel[]): void {
  defaultChannels = channels.slice();
}

export function getDefaultQuestionChannels(): QuestionChannel[] {
  return defaultChannels.slice();
}

/** Ask the user via every wired channel; resolve to whatever channel
 *  answered first. Returns a structured fallback when no channel
 *  responds within `timeoutMs`. */
export async function requestQuestion(opts: RequestQuestionOpts): Promise<RequestQuestionResult> {
  const channels = opts.channels ?? defaultChannels;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_QUESTION_TIMEOUT_MS;
  const onTimeout = opts.onTimeout ?? defaultOnTimeout;
  const started = Date.now();

  if (channels.length === 0) {
    return {
      result: onTimeout(),
      channel: 'all-failed',
      elapsedMs: Date.now() - started,
    };
  }

  const cancelOthers = async (winner: QuestionChannel | null): Promise<void> => {
    await Promise.allSettled(
      channels
        .filter((c) => c !== winner)
        .map(async (c) => {
          try { await c.cancel(); } catch { /* swallow */ }
        }),
    );
  };

  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
    (timer as unknown as { unref?: () => void }).unref?.();
  });

  const channelTasks: Array<Promise<{ channel: QuestionChannel; result: AskUserQuestionResult }>> =
    channels.map(async (channel) => {
      const result = await channel.ask(opts.request);
      if (result === null) {
        // Channel not configured — never settles this race; let
        // Promise.race wait on the others. We do this by returning a
        // never-settling Promise so this branch is effectively dropped.
        return await new Promise<{ channel: QuestionChannel; result: AskUserQuestionResult }>(() => {
          /* never resolves — channel opted out */
        });
      }
      return { channel, result };
    });

  let winnerEntry: { channel: QuestionChannel; result: AskUserQuestionResult } | 'timeout';
  try {
    winnerEntry = await Promise.race([Promise.race(channelTasks), timeoutPromise]);
  } catch (err) {
    if (timer) clearTimeout(timer);
    await cancelOthers(null);
    // Treat any thrown error as "all-failed" — LLM gets the structured
    // fallback. Channel impls should resolve normally with cancelled=
    // true on user dismiss; throws indicate transport breakage.
    return {
      result: onTimeout(),
      channel: 'all-failed',
      elapsedMs: Date.now() - started,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (winnerEntry === 'timeout') {
    await cancelOthers(null);
    return {
      result: onTimeout(),
      channel: 'timeout',
      elapsedMs: Date.now() - started,
    };
  }

  await cancelOthers(winnerEntry.channel);
  return {
    result: winnerEntry.result,
    channel: winnerEntry.channel.name,
    elapsedMs: Date.now() - started,
  };
}

function defaultOnTimeout(): AskUserQuestionResult {
  return { answers: {}, cancelled: true };
}
