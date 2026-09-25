'use client';

// PR #3 — `+` 버튼 popover. 종류 선택 후 add. 'chat' 은 PR #4.5 이전
// 에는 그냥 새 sessionId 로 add (SessionPicker 가 이번 PR 에 없으므로
// minimal UX). PR #4.5 에서 'chat' 클릭 시 SessionPicker 모달 열도록
// 변경.
//
// 2026-05-06 fix — popover 가 안 떴던 버그: WorkspaceStrip 의 데스크탑
// 컨테이너가 `overflow-x-auto` 라 자식 absolute popover 도 vertical
// clipping 됨 (CSS spec — overflow-x:auto 는 overflow-y 를 visible 에서
// auto 로 강제). createPortal 로 document.body 에 mount + getBoundingClientRect
// 로 button 위치 따라가는 fixed positioning 으로 우회. outside-click /
// Esc 는 button + popover 두 ref 모두 contains 로 검사.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useWorkspace } from './WorkspaceProvider';
import { Plus, MessageSquare, TerminalSquare, ClipboardList, KanbanSquare, Sliders, Settings } from 'lucide-react';

// Phase 2 (PWA chat ↔ voice 일원화 · 2026-05-07) — 'voice' kind 제거.
// chat 탭의 헤더 mic toggle 이 voice 진입점을 흡수.
// Surface-unification v2.2 V2.2-6 (2026-05-11) — 'scheduler' kind 제거.
// scheduler 는 이제 workflow 의 scheduleTrigger 노드 1급 시민이라 별
// 탭 종이 아니라 workflow tab 하나로 통합 (사용자 facing 으로 scheduler
// 단어 제거).
const KINDS = [
  { kind: 'chat' as const, label: 'chat', icon: MessageSquare },
  { kind: 'term' as const, label: 'terminal', icon: TerminalSquare },
  { kind: 'intake' as const, label: 'intake', icon: ClipboardList },
  { kind: 'tasks' as const, label: 'tasks', icon: KanbanSquare },
  { kind: 'control' as const, label: 'control', icon: Sliders },
  { kind: 'settings' as const, label: 'settings', icon: Settings },
];

export function AddTabPopover() {
  const ws = useWorkspace();
  const { addTab, activateOrAdd } = ws;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  // addTab 은 새 chat 즉시 mint (legacy 경로 — picker 가 부재 시 fallback).
  void addTab;

  // Position popover under the button using getBoundingClientRect.
  // Fixed positioning + portal mount keeps the menu out of the strip's
  // overflow-x:auto clipping context.
  useLayoutEffect(() => {
    if (!open) return;
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      setPos({ top: rect.bottom + 4, left: rect.left });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent): void => {
      const t = e.target as Node;
      // Click on either the button or the popover itself stays open.
      if (buttonRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onEsc);
    // Close on viewport changes — re-positioning while scrolling/
    // resizing is overkill for a 6-item menu; users will reopen.
    const onScrollOrResize = (): void => setOpen(false);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open]);

  // PR #4.5 — chat 클릭 = SessionPicker 열기 (PLAN §3.12 인터랙션 sheet).
  const choose = (kind: typeof KINDS[number]['kind']): void => {
    if (kind === 'chat') {
      ws.openPicker({ kind: 'addNewChat' });
    } else {
      activateOrAdd(kind);
    }
    setOpen(false);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label="add tab"
        title="새 탭 (+)"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <Plus className="h-4 w-4" />
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={popoverRef}
          role="menu"
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 100 }}
          className="w-44 rounded-md border border-border bg-popover py-1 shadow-md"
        >
          {KINDS.map((opt) => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.kind}
                type="button"
                role="menuitem"
                onClick={() => choose(opt.kind)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-secondary"
              >
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1">{opt.label}</span>
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
