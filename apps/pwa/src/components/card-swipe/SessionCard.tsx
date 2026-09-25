'use client';

// R5.1 — single session card. Pure presentational; the surrounding
// CardSweepView owns swipe gesture + decision dispatch. Splitting
// keeps the card cheap to render in tests + lets a static export
// check pin the structural markers without DOM mounting.
//
// Cross-ref:
//   src/nexus/api/sessions-active.ts (ActiveSessionSnapshot shape)
//   apps/pwa/src/components/card-swipe/CardSweepView.tsx (parent)
//   내부 문서 `ROADMAP-pwa-pre-ios-gap-2026-05-09` §R5

export type CardSessionStatus = 'active' | 'idle' | 'stale';

export interface CardSessionData {
  id: string;
  msgCount: number;
  lastTurnAt: string;
  ageMs: number;
  status: CardSessionStatus;
  lastMsgPreview?: string;
  origin?: string;
}

interface Props {
  session: CardSessionData;
  /** When true, the card is the topmost in the deck. Lower-z cards
   *  render with reduced opacity + slight offset for the deck visual. */
  active: boolean;
  /** 0-based stack index from the top. The visual z-stack uses
   *  `transform: translateY(<index> * 6px)` so behind-cards peek. */
  stackIndex?: number;
}

const STATUS_LABEL: Record<CardSessionStatus, string> = {
  active: '대화중',
  idle: '대기중',
  stale: '오래됨',
};

const STATUS_COLOR: Record<CardSessionStatus, string> = {
  active: 'bg-emerald-500/15 text-emerald-700 ring-emerald-500/30',
  idle: 'bg-amber-500/15 text-amber-700 ring-amber-500/30',
  stale: 'bg-muted text-muted-foreground ring-border',
};

/** Render a human-readable "X분 전" / "X시간 전" / "X일 전" label. */
function ageLabel(ageMs: number): string {
  const min = Math.floor(ageMs / 60_000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  return `${day}일 전`;
}

export function SessionCard({ session, active, stackIndex = 0 }: Props) {
  const z = active ? 30 : 30 - stackIndex;
  const offsetY = active ? 0 : stackIndex * 6;
  const scale = active ? 1 : Math.max(0.92, 1 - stackIndex * 0.04);
  const opacity = active ? 1 : Math.max(0.6, 1 - stackIndex * 0.18);

  return (
    <article
      data-testid="session-card"
      data-session-id={session.id}
      data-active={active ? 'true' : 'false'}
      data-stack-index={stackIndex}
      className="absolute inset-0 flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-lg ring-1 ring-foreground/5"
      style={{ zIndex: z, transform: `translateY(${offsetY}px) scale(${scale})`, opacity }}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-heading text-base font-medium" data-testid="session-card-id">
            {session.id}
          </h3>
          <p className="text-xs text-muted-foreground" data-testid="session-card-age">
            {ageLabel(session.ageMs)} · 메시지 {session.msgCount}
            {session.origin ? ` · ${session.origin}` : ''}
          </p>
        </div>
        <span
          data-testid="session-card-status"
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${STATUS_COLOR[session.status]}`}
        >
          {STATUS_LABEL[session.status]}
        </span>
      </header>
      {session.lastMsgPreview && (
        <p className="line-clamp-3 text-sm text-foreground" data-testid="session-card-preview">
          {session.lastMsgPreview}
        </p>
      )}
      {/* Hint row · only on the active (topmost) card so behind-stack
          cards stay visually clean. */}
      {active && (
        <footer
          data-testid="session-card-hint"
          className="mt-auto grid grid-cols-2 gap-1 pt-2 text-[10px] text-muted-foreground"
        >
          <span>← 거절</span>
          <span className="text-right">승인 →</span>
          <span>↑ 잠시 멈춤</span>
          <span className="text-right">펼치기 ↓</span>
        </footer>
      )}
    </article>
  );
}
