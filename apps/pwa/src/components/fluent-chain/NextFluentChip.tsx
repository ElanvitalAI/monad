'use client';

// W9c Z13-a · Next-Scenario Fluent chip — shown on `task done` so the
// user is one click from the next action. Cf. Z10 substrate (#2438).
//
// The chip subscribes to a `TaskDonePreviewRequest` (the surface owns
// the trigger — task board · workflow run done event). On mount it
// hits `POST /v1/next-fluent/preview` and renders the top suggestions
// + transcript-snippet endorsements. The "trigger" callback is wired
// by the surface to dispatch the chosen action; the chip itself is
// presentation only.

import { useEffect, useState, type ReactElement } from 'react';
import {
  createFluentChainApi,
  type FluentChainApiClient,
  type NextFluentCardWire,
  type NextFluentSuggestionWire,
  type TaskDonePreviewRequest,
} from '@/lib/fluent-chain-api';

export interface NextFluentChipProps {
  trigger: TaskDonePreviewRequest;
  /** Test seam — production uses `createFluentChainApi({ baseUrl: window.location.origin })`. */
  api?: FluentChainApiClient;
  /** Hook for the surface to act on a user click. The kind is the
   *  canonical action label (`continue-similar-task` etc.). */
  onChoose?: (kind: string, suggestion: NextFluentSuggestionWire) => void;
  /** Max suggestions to render. Default 3. */
  limit?: number;
}

export function NextFluentChip(props: NextFluentChipProps): ReactElement | null {
  const [state, setState] = useState<NextFluentChipState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const api = props.api ?? createFluentChainApi({ baseUrl: window.location.origin });
    api.preview(props.trigger)
      .then((result) => {
        if (cancelled) return;
        if (result.kind === 'card') setState({ kind: 'card', card: result.card });
        else if (result.kind === 'no-suggestions') setState({ kind: 'empty' });
        else setState({ kind: 'disabled' });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => { cancelled = true; };
  }, [props.api, props.trigger.refId, props.trigger.refKind, props.trigger.outcome, props.trigger.completedAt]);

  if (state.kind === 'loading') {
    return <span className="text-xs opacity-60">checking next-action…</span>;
  }
  if (state.kind === 'disabled' || state.kind === 'empty') {
    return null;
  }
  if (state.kind === 'error') {
    return <span className="text-xs text-rose-700">next-action: {state.message}</span>;
  }
  const limit = props.limit ?? 3;
  const items = state.card.suggestions.slice(0, limit);
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs" data-fluent-ref={props.trigger.refId}>
      <span className="opacity-60">next:</span>
      {items.map((s) => (
        <button
          key={s.kind}
          type="button"
          className="rounded-full border border-zinc-300 bg-white px-2 py-0.5 hover:bg-zinc-50"
          onClick={() => props.onChoose?.(s.kind, s)}
          title={s.reason || s.kind}
        >
          {s.kind}
          {s.endorsedBy !== 'none' && (
            <span className="ml-1 text-[10px] opacity-60">· {s.endorsedBy}</span>
          )}
        </button>
      ))}
    </div>
  );
}

type NextFluentChipState =
  | { kind: 'loading' }
  | { kind: 'card'; card: NextFluentCardWire }
  | { kind: 'empty' }
  | { kind: 'disabled' }
  | { kind: 'error'; message: string };
