'use client';

// PR #3 — 단일 탭 wrapper. display:none 으로 활성/비활성 토글.
// **unmount 금지** — 비활성 탭의 input buffer / 스크롤 위치 / xterm
// instance 가 살아있어야 워크스페이스의 의의가 성립 (HANDOFF §5.1 #1).

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface TabPanelProps {
  id: string;
  active: boolean;
  children: ReactNode;
}

export function TabPanel({ id, active, children }: TabPanelProps) {
  return (
    <div
      role="tabpanel"
      data-tab-id={id}
      data-active={active ? 'true' : 'false'}
      // hidden attribute 은 display:none 보다 약함 (브라우저는 hidden
      // 인 element 를 layout 에서 빼지만 child render tree 는 보존).
      // 우리는 **일관된 `display:none`** 만 쓰고 mount 는 절대 풀지
      // 않는다.
      className={cn('h-full min-h-0', active ? 'block' : 'hidden')}
    >
      {children}
    </div>
  );
}
