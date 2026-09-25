'use client';

import { useState } from 'react';
import { FinanceDashboardPanel } from './FinanceDashboardPanel';
import { SignalBoardPanel } from './SignalBoardPanel';
import { OpsPanel } from './OpsPanel';
import { LogsPanel } from './LogsPanel';
import { LoopsPanel } from '@/components/loops/LoopsPanel';

/**
 * 투자 Dashboard 서브탭 — 통합 시그널(4소스 감지 피드)·개요(기존 시그널 대시보드)·
 * 운영 상황판(자율 시스템 현재 상태·이상·전이)·루프 오케스트라(5 자율루프 순환 그래프).
 * 대표 지시(2026-07-10): 여러 루프에이전트 감지·동작 상태를 한눈에.
 */
const TABS = [
  { id: 'signals', label: '통합 시그널' },
  { id: 'overview', label: '개요' },
  { id: 'ops', label: '운영 상황판' },
  { id: 'loops', label: '루프 오케스트라' },
  { id: 'logs', label: 'Logs' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function DashboardTabs() {
  const [tab, setTab] = useState<TabId>('signals');
  return (
    <div>
      <div className="mx-auto max-w-[1400px] px-4 pt-4">
        <div className="flex gap-1 border-b border-border">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={[
                '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors',
                tab === t.id
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {tab === 'signals' ? <SignalBoardPanel /> : tab === 'overview' ? <FinanceDashboardPanel /> : tab === 'ops' ? <OpsPanel /> : tab === 'logs' ? <LogsPanel /> : <LoopsPanel />}
    </div>
  );
}
