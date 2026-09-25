'use client';

// PR #4 — 모바일 탭 picker 모달. 압축 strip `⋮ N more` 클릭 시 열림.
// 활성 + 비활성 탭을 모두 카드로 보여주고 선택 시 활성화 + close.
// PLAN §3.8 mockup.

import { useEffect, useRef } from 'react';
import { X, MessageSquare, TerminalSquare, ClipboardList, GitBranch, KanbanSquare, Sliders, Settings } from 'lucide-react';
import { useWorkspace } from './WorkspaceProvider';
import { tabsInOrder } from '@/lib/workspace/store';
import type { WorkspaceTab, WorkspaceTabKind } from '@/lib/workspace/types';
import { cn } from '@/lib/utils';

// Phase 2 (PWA chat ↔ voice 일원화 · 2026-05-07) — 'voice' kind 제거.
// Surface-unification v2.2 V2.2-6 (2026-05-11) — 'scheduler' kind 제거
// (workflow 의 scheduleTrigger 노드로 흡수).
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
  if (tab.kind === 'tasks') return 'tasks';
  return tab.kind;
}

export interface TabPickerModalProps {
  open: boolean;
  onClose: () => void;
}

export function TabPickerModal({ open, onClose }: TabPickerModalProps) {
  const { state, activateTab, closeTab } = useWorkspace();
  const ordered = tabsInOrder(state);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [open, onClose]);

  if (!open) return null;

  // chat#N 인덱스
  const chatIndexById = new Map<string, number>();
  let chatCount = 0;
  for (const t of ordered) {
    if (t.kind === 'chat') {
      chatCount += 1;
      chatIndexById.set(t.id, chatCount);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="탭 전환"
      className="fixed inset-0 z-50 flex flex-col bg-background"
    >
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
        <h2 className="text-sm font-medium">탭 전환</h2>
        <button
          type="button"
          aria-label="close"
          onClick={onClose}
          className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div ref={ref} className="flex-1 overflow-y-auto p-3 space-y-2">
        {ordered.length === 0 && (
          <p className="text-center text-sm text-muted-foreground py-6">
            아직 탭이 없습니다.
          </p>
        )}
        {ordered.map((tab) => {
          const Icon = KIND_ICON[tab.kind];
          const active = state.activeId === tab.id;
          const idx = tab.kind === 'chat' ? chatIndexById.get(tab.id) ?? 0 : 0;
          const label = tabLabel(tab, idx);
          return (
            <div
              key={tab.id}
              className={cn(
                'flex items-center gap-3 rounded-lg border px-3 py-3 text-sm transition-colors',
                active
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-card hover:bg-secondary',
              )}
            >
              <span
                className={cn(
                  'inline-flex h-2 w-2 shrink-0 rounded-full',
                  active ? 'bg-primary' : 'bg-muted-foreground/30',
                )}
                aria-hidden
              />
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <button
                type="button"
                onClick={() => {
                  activateTab(tab.id);
                  onClose();
                }}
                className="flex-1 truncate text-left"
              >
                {label}
              </button>
              <button
                type="button"
                aria-label={`close ${label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
