'use client';

// 2026-05-07 dogfood feedback — TopBar 안 inline 으로 mount 되는 압축
// workspace strip. 사용자가 메뉴 row 와 multitab strip 가 별도 row
// 로 stack 된 게 답답하다 호소 → h-9 한 줄에 통합.
//
// 핵심 결정:
//   - useWorkspaceOptional() — provider 미mount 환경 (테스트 또는 future
//     route override) 에서 null 반환 → 컴포넌트 자체가 graceful no-op.
//   - 탭 0개 일 때 자체 hidden — 첫 진입 사용자가 메뉴 + 아이콘만 보고
//     혼란 없이 시작.
//   - chat#N 라벨 인덱스 산출은 WorkspaceStrip 의 same logic 재사용 —
//     순서대로 chat 카운트.
//   - 모바일 (<sm) 에서는 활성 탭만 보이고 다른 탭은 +N 카운트로 압축.
//     데스크탑 (sm+) 에서는 horizontal scroll 가능한 풀 list.

import { useState } from 'react';
import {
  ClipboardList,
  GitBranch,
  KanbanSquare,
  MessageSquare,
  MoreVertical,
  Settings,
  Sliders,
  TerminalSquare,
  X,
} from 'lucide-react';
import { useWorkspaceOptional } from '@/components/workspace/WorkspaceProvider';
import { AddTabPopover } from '@/components/workspace/AddTabPopover';
import { TabPickerModal } from '@/components/workspace/TabPickerModal';
import type { WorkspaceTab, WorkspaceTabKind } from '@/lib/workspace/types';
import { tabsInOrder } from '@/lib/workspace/store';
import { cn } from '@/lib/utils';

// Phase 2 (PWA chat ↔ voice 일원화 · 2026-05-07) — 'voice' kind 제거.
// Surface-unification v2.2 V2.2-6 (2026-05-11) — 'scheduler' kind 제거.
const KIND_ICON: Record<WorkspaceTabKind, typeof MessageSquare> = {
  chat: MessageSquare,
  term: TerminalSquare,
  intake: ClipboardList,
  tasks: KanbanSquare,
  workflows: GitBranch,
  control: Sliders,
  settings: Settings,
};

function tabLabel(tab: WorkspaceTab, chatIndex: number): string {
  if (tab.kind === 'chat') return tab.title ?? `chat#${chatIndex}`;
  if (tab.kind === 'term') return 'terminal';
  return tab.kind;
}

export function TopBarWorkspaceStrip() {
  const ws = useWorkspaceOptional();
  const [pickerOpen, setPickerOpen] = useState(false);
  if (!ws) return null;
  const ordered = tabsInOrder(ws.state);
  // Empty workspace — nothing to show. AddTabPopover 는 sidebar nav
  // 에서 직접 진입 가능하므로 strip 자체를 숨겨도 사용자 entry 미상실.
  if (ordered.length === 0) return null;

  const chatIndexById = new Map<string, number>();
  let chatCount = 0;
  for (const t of ordered) {
    if (t.kind === 'chat') {
      chatCount += 1;
      chatIndexById.set(t.id, chatCount);
    }
  }
  const activeTab = ordered.find((t) => t.id === ws.state.activeId);
  const activeIdx = activeTab?.kind === 'chat'
    ? chatIndexById.get(activeTab.id) ?? 0
    : 0;
  const inactiveCount = Math.max(0, ordered.length - (activeTab ? 1 : 0));

  return (
    <>
      {/* 데스크탑 / 태블릿 (sm+) — 풀 list, scroll. min-w-0 + flex-1 로
          가운데 영역 잡고 ml-auto 의 우측 아이콘 row 와 분리. */}
      <div
        role="tablist"
        aria-label="workspace tabs"
        data-elanous-component="topbar-workspace-strip"
        className="hidden sm:flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1"
      >
        {ordered.map((tab) => {
          const Icon = KIND_ICON[tab.kind];
          const active = ws.state.activeId === tab.id;
          const idx = tab.kind === 'chat' ? chatIndexById.get(tab.id) ?? 0 : 0;
          const label = tabLabel(tab, idx);
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              onClick={() => ws.activateTab(tab.id)}
              className={cn(
                'group flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium transition-colors cursor-pointer',
                active
                  ? 'bg-primary/15 text-foreground ring-1 ring-primary/40'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
              )}
            >
              <Icon className="h-3 w-3 shrink-0" />
              <span className="max-w-[120px] truncate">{label}</span>
              <button
                type="button"
                aria-label={`close ${label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  ws.closeTab(tab.id);
                }}
                className="ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded text-muted-foreground/60 opacity-0 transition-opacity hover:bg-background hover:text-foreground group-hover:opacity-100 data-[active=true]:opacity-100"
                data-active={active ? 'true' : 'false'}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          );
        })}
        <AddTabPopover />
      </div>

      {/* 모바일 (<sm) — 활성 탭 1개 + 나머지 카운트. iPhone 좁은 폭에서
          메뉴 + 활성 탭 + 음성 + 설정 모두 한 줄에 들어가도록 압축. */}
      <div
        role="tablist"
        aria-label="workspace tabs (compact)"
        data-elanous-component="topbar-workspace-strip-mobile"
        className="flex sm:hidden min-w-0 flex-1 items-center gap-1 px-1"
      >
        {activeTab && (
          <div className="flex flex-1 min-w-0 items-center gap-1 rounded-md bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-primary/40">
            {(() => {
              const Icon = KIND_ICON[activeTab.kind];
              return <Icon className="h-3 w-3 shrink-0" />;
            })()}
            <span className="flex-1 truncate">{tabLabel(activeTab, activeIdx)}</span>
            <button
              type="button"
              aria-label="close"
              onClick={() => ws.closeTab(activeTab.id)}
              className="inline-flex h-3.5 w-3.5 items-center justify-center rounded hover:bg-background"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </div>
        )}
        {inactiveCount > 0 && (
          <button
            type="button"
            aria-label={`other tabs (${inactiveCount})`}
            onClick={() => setPickerOpen(true)}
            className="inline-flex h-6 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <MoreVertical className="h-3 w-3" />
            <span>{inactiveCount}</span>
          </button>
        )}
        <AddTabPopover />
      </div>

      <TabPickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </>
  );
}
