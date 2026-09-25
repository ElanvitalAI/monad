'use client';

// W9c Z13-c · Morning Showroom · 4-pane conversational standup.
// Cf. Z7 substrate (#2440) digest-showroom-adapter.
//
// The component renders the 4 panes (yesterday · today · blockers ·
// opportunities) as a responsive grid (single column on phones, 2x2
// on desktops). Full-screen lane focus is deferred to a follow-up
// gesture surface — this PR ships the data wire + grid only so the
// substrate is testable end-to-end without depending on PWA gesture
// infra.

import { useEffect, useState, type ReactElement } from 'react';
import {
  createMorningShowroomApi,
  type MorningDigestRequest,
  type MorningShowroomApiClient,
  type MorningShowroomCardWire,
  type MorningShowroomLaneWire,
} from '@/lib/morning-showroom-api';

export interface MorningShowroomProps {
  request: MorningDigestRequest;
  /** Test seam — production uses `createMorningShowroomApi({ baseUrl: window.location.origin })`. */
  api?: MorningShowroomApiClient;
}

const LANE_TITLES: Record<MorningShowroomLaneWire['lane'], string> = {
  yesterday: 'Yesterday',
  today: 'Today',
  blockers: 'Blockers',
  opportunities: 'Opportunities',
};

const LANE_ICON: Record<MorningShowroomLaneWire['lane'], string> = {
  yesterday: '◐',
  today: '▶',
  blockers: '⛔',
  opportunities: '✦',
};

export function MorningShowroom(props: MorningShowroomProps): ReactElement {
  const [state, setState] = useState<MorningState>({ kind: 'loading' });
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const api = props.api ?? createMorningShowroomApi({ baseUrl: window.location.origin });
    setState({ kind: 'loading' });
    api.compose(props.request)
      .then((card) => {
        if (!cancelled) setState(card.lanes.length === 0 ? { kind: 'empty' } : { kind: 'card', card });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'unavailable' });
      });
    return () => { cancelled = true; };
  }, [props.api, props.request.date, props.request.windowStart, props.request.windowEnd, retryKey]);

  return <MorningShowroomContent state={state} onRetry={() => setRetryKey((key) => key + 1)} />;
}

export function MorningShowroomContent({ state, onRetry }: { state: MorningState; onRetry: () => void }): ReactElement {
  if (state.kind === 'loading') {
    return <div className="p-4 text-sm opacity-70">Morning showroom을 준비하고 있습니다…</div>;
  }
  if (state.kind === 'unavailable') {
    return (
      <section className="p-4 text-sm" data-testid="morning-showroom-unavailable">
        <h2 className="font-semibold">Morning showroom이 아직 연결되지 않았습니다.</h2>
        <p className="mt-1 opacity-70">다이제스트를 만들 수 있는 곳이 준비되면 이 화면에 표시됩니다.</p>
        <button type="button" className="mt-3 underline" onClick={onRetry}>다시 시도</button>
      </section>
    );
  }
  if (state.kind === 'empty') {
    return (
      <section className="p-4 text-sm" data-testid="morning-showroom-empty">
        <h2 className="font-semibold">아직 보여 줄 Morning showroom 항목이 없습니다.</h2>
        <p className="mt-1 opacity-70">오늘의 실행 기록이 쌓이면 이곳에서 아침 다이제스트를 확인할 수 있습니다.</p>
        <button type="button" className="mt-3 underline" data-testid="morning-showroom-empty-retry" onClick={onRetry}>새로 고침</button>
      </section>
    );
  }
  return (
    <section className="morning-showroom p-4" data-date={state.card.date}>
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">Morning showroom · {state.card.date}</h2>
        <time className="text-xs opacity-60" dateTime={new Date(state.card.createdAt).toISOString()}>
          {new Date(state.card.createdAt).toLocaleTimeString()}
        </time>
      </header>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {state.card.lanes.map((lane) => (
          <LaneCard key={lane.lane} lane={lane} />
        ))}
      </div>
    </section>
  );
}

interface LaneCardProps {
  lane: MorningShowroomLaneWire;
}

function LaneCard({ lane }: LaneCardProps): ReactElement {
  return (
    <article className="rounded border border-zinc-200 bg-white p-3" data-lane={lane.lane}>
      <header className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide opacity-70">
        <span aria-hidden>{LANE_ICON[lane.lane]}</span>
        <span>{LANE_TITLES[lane.lane]}</span>
        {lane.modelId && <span className="ml-auto opacity-60">· {lane.modelId}</span>}
      </header>
      <pre className="whitespace-pre-wrap text-sm leading-snug">{lane.text}</pre>
    </article>
  );
}

export type MorningState =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'unavailable' }
  | { kind: 'card'; card: MorningShowroomCardWire };
