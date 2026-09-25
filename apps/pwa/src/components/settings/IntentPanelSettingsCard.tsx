'use client';

// IntentPanel display-mode setting (2026-05-09).
//
// User feedback (CV-3 dogfood): "showroom intent 표시 ... 고정 형태가
// 맞는지 고민 필요. 셋팅을 통해서 유저가 선택하는 것으로 하는 것이 필요".
// This card exposes the 3-mode toggle:
//
//   fixed  — always visible above ShowroomInput (default · pre-2026-05-09 behavior)
//   popup  — show only briefly after each turn (auto-dismiss)
//   off    — hidden entirely
//
// State source = `intent-panel-storage` localStorage shim. Cross-tab
// sync via the same StorageEvent fan-out. Subscribes on mount so a
// switch flip in another tab updates the active radio without needing
// a page refresh.

import { useEffect, useState } from 'react';

import {
  getIntentPanelDisplayMode,
  setIntentPanelDisplayMode,
  subscribeIntentPanelDisplayMode,
  type IntentPanelDisplayMode,
} from '@/components/intent-panel/intent-panel-storage';

interface ModeOption {
  value: IntentPanelDisplayMode;
  label: string;
  blurb: string;
}

const OPTIONS: readonly ModeOption[] = [
  {
    value: 'fixed',
    label: '고정 (Fixed)',
    blurb: '입력 바 위에 항상 표시. 키보드 위주 dogfood 에 좋음.',
  },
  {
    value: 'popup',
    label: '팝업 (Popup)',
    blurb: '턴이 끝날 때마다 잠깐 (~6초) 나타나고 자동 dismiss. 모바일 화면 절약.',
  },
  {
    value: 'off',
    label: '끔 (Off)',
    blurb: '완전 숨김. 입력만으로 진행하고 싶을 때.',
  },
];

export function IntentPanelSettingsCard() {
  const [mode, setMode] = useState<IntentPanelDisplayMode>('fixed');
  // Hydration safety — start with the SSR default, sync from
  // localStorage on mount + cross-tab via storage events. Same
  // pattern as IntentPanel container + WelcomeCard.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    setMode(getIntentPanelDisplayMode());
    return subscribeIntentPanelDisplayMode(setMode);
  }, []);

  const choose = (next: IntentPanelDisplayMode): void => {
    setIntentPanelDisplayMode(next);
    setMode(next);
  };

  return (
    <section
      data-testid="intent-panel-settings"
      className="rounded-lg border bg-card p-4 shadow-sm"
    >
      <header className="space-y-1">
        <h2 className="text-sm font-medium">Intent Panel</h2>
        <p className="text-xs text-muted-foreground">
          Showroom 의 intent 6-button 패널 표시 방식을 선택합니다.
        </p>
      </header>
      <div role="radiogroup" aria-label="intent panel display mode" className="mt-3 space-y-2">
        {OPTIONS.map((opt) => {
          const active = mounted && mode === opt.value;
          return (
            <label
              key={opt.value}
              data-testid={`intent-panel-mode-${opt.value}`}
              className="flex cursor-pointer items-start gap-3 rounded-md border border-border/60 p-3 hover:border-border"
              data-active={active ? 'true' : 'false'}
            >
              <input
                type="radio"
                name="intent-panel-display-mode"
                value={opt.value}
                checked={active}
                onChange={() => choose(opt.value)}
                className="mt-0.5 h-4 w-4"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{opt.label}</span>
                <span className="text-xs text-muted-foreground">{opt.blurb}</span>
              </span>
            </label>
          );
        })}
      </div>
    </section>
  );
}
