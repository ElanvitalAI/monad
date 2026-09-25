// PWA `/setup` Phase 1 (2026-05-19) — wizard layout shell.
//
// v2 단순화: step machine 없음. 단순 wrapper — header (logo) + main.
// `/setup` 자체와 `/setup/done` 만 라우트 됨. 추가 step 도입 시 본 layout
// 이 sidebar 등을 흡수하도록 grow.

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'monad · setup',
  description: 'First-time LLM provider setup for monad PWA.',
};

export default function SetupLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          monad · setup
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          LLM provider 셋업
        </h1>
        <p className="text-sm text-muted-foreground">
          chat 을 시작하려면 LLM provider 하나만 골라주세요. 나머지 (persona ·
          channels · iOS · voice) 는 <span className="font-mono">/settings</span>{' '}
          에서 언제든지 설정할 수 있어요.
        </p>
      </header>
      <section className="flex flex-1 flex-col">{children}</section>
    </main>
  );
}
