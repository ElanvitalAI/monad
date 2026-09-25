'use client';

// I7 (2026-05-12) — single memo-intake card.
//
// Pure presentational. Parent MemoIntakePreview owns swipe gesture +
// decision dispatch. Splitting keeps the card cheap for snapshot tests
// and lets static export render the structural markers without a DOM.
//
// Cross-ref:
//   apps/pwa/src/components/intake/MemoIntakePreview.tsx (parent)
//   apps/pwa/src/lib/intake-pipeline-api.ts (MemoCard / PreviewTask shapes)
//   내부 문서 §2

import type { MemoCard } from '@/lib/intake-pipeline-api';

export type CardVerdict = 'pending' | 'approved' | 'rejected' | 'deferred';

const VERDICT_LABEL: Record<CardVerdict, string> = {
  pending: '대기',
  approved: '승인',
  rejected: '거절',
  deferred: '잠시 멈춤',
};

const VERDICT_COLOR: Record<CardVerdict, string> = {
  pending: 'bg-muted text-muted-foreground ring-border',
  approved: 'bg-emerald-500/15 text-emerald-700 ring-emerald-500/30',
  rejected: 'bg-rose-500/15 text-rose-700 ring-rose-500/30',
  deferred: 'bg-amber-500/15 text-amber-700 ring-amber-500/30',
};

const PRIORITY_COLOR: Record<string, string> = {
  high: 'bg-orange-500/15 text-orange-700 ring-orange-500/30',
  medium: 'bg-sky-500/15 text-sky-700 ring-sky-500/30',
  low: 'bg-muted text-muted-foreground ring-border',
};

const CATEGORY_GLYPH: Record<string, string> = {
  research: '🔍',
  'research-and-plan': '📋',
  'dev-feature': '⚙',
  'dev-spec': '📐',
  cognitive: '🧠',
  debug: '🛠',
  'workflow-update': '↻',
};

interface Props {
  card: MemoCard;
  verdict: CardVerdict;
  active: boolean;
  stackIndex?: number;
}

export function MemoIntakeCard({ card, verdict, active, stackIndex = 0 }: Props) {
  const z = active ? 30 : 30 - stackIndex;
  const offsetY = active ? 0 : stackIndex * 6;
  const scale = active ? 1 : Math.max(0.92, 1 - stackIndex * 0.04);
  const opacity = active ? 1 : Math.max(0.6, 1 - stackIndex * 0.18);
  const { task } = card;
  const refCount = task.urls.length + task.keywords.length + task.refs.length;
  return (
    <article
      data-testid="memo-intake-card"
      data-task-key={task.taskKey}
      data-active={active ? 'true' : 'false'}
      data-stack-index={stackIndex}
      data-verdict={verdict}
      className="absolute inset-0 flex flex-col gap-2 rounded-2xl border border-border bg-card p-5 shadow-lg ring-1 ring-foreground/5"
      style={{ zIndex: z, transform: `translateY(${offsetY}px) scale(${scale})`, opacity }}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[10px] uppercase tracking-wider text-muted-foreground" data-testid="memo-card-mission">
            {card.missionTitle}
          </p>
          <h3 className="font-heading text-base font-medium leading-snug" data-testid="memo-card-title">
            {task.title}
          </h3>
        </div>
        <span
          data-testid="memo-card-verdict"
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${VERDICT_COLOR[verdict]}`}
        >
          {VERDICT_LABEL[verdict]}
        </span>
      </header>

      <p className="line-clamp-3 text-sm text-foreground" data-testid="memo-card-intent">
        {task.intent}
      </p>

      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
        <span
          data-testid="memo-card-category"
          className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-muted-foreground ring-1 ring-border"
        >
          <span aria-hidden>{CATEGORY_GLYPH[task.category] ?? '•'}</span>
          {task.category}
        </span>
        <span
          data-testid="memo-card-priority"
          className={`rounded-full px-2 py-0.5 font-medium ring-1 ${PRIORITY_COLOR[task.priority] ?? PRIORITY_COLOR.low}`}
        >
          {task.priority}
        </span>
        {task.workflowEligible ? (
          <span
            data-testid="memo-card-workflow"
            className="rounded-full bg-violet-500/15 px-2 py-0.5 text-violet-700 ring-1 ring-violet-500/30"
          >
            workflow
          </span>
        ) : (
          <span
            data-testid="memo-card-workflow"
            className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground ring-1 ring-border"
          >
            no-workflow
          </span>
        )}
        {refCount > 0 && (
          <span
            data-testid="memo-card-refs"
            className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground ring-1 ring-border"
          >
            {refCount} ref{refCount === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {active && (
        <footer
          data-testid="memo-card-hint"
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
