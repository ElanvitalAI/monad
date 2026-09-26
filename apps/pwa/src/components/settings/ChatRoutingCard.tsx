'use client';

// ChatRoutingCard — dogfood polish (2026-05-14 EoD #8).
//
// Two toggles for the chat input chip stack:
//   • Automatic routing  — mission router predict + chip mission tag.
//                           default OFF (사용자 명시).
//   • ACP CLI backends   — Codex / Claude Code / Gemini chip options.
//                           OFF = elanous-builtin 고정 ("베이직 모드").
//                           default ON.
//
// Source of truth: localStorage via `chat-routing-storage`. Subscribes
// on mount so flips from another tab take effect without a refresh.

import { useEffect, useState } from 'react';

import {
  DEFAULT_CHAT_ROUTING,
  getChatRouting,
  setAcpBackends,
  setAutoRouting,
  subscribeChatRouting,
  type ChatRoutingState,
} from '@/lib/chat-routing-storage';

export function ChatRoutingCard() {
  const [state, setState] = useState<ChatRoutingState>(DEFAULT_CHAT_ROUTING);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    setState(getChatRouting());
    return subscribeChatRouting(setState);
  }, []);

  const toggleAuto = (next: boolean): void => {
    setAutoRouting(next);
    setState((s) => ({ ...s, autoRouting: next }));
  };
  const toggleAcp = (next: boolean): void => {
    setAcpBackends(next);
    setState((s) => ({ ...s, acpBackends: next }));
  };

  return (
    <section
      data-testid="chat-routing-settings"
      className="rounded-lg border bg-card p-4 shadow-sm"
    >
      <header className="space-y-1">
        <h2 className="text-sm font-medium">Showroom (chat input chip stack)</h2>
        <p className="text-xs text-muted-foreground">
          입력 바의 backend chip · mission tag · ACP CLI 후보들의 활성화 토글. 두 토글 모두 OFF = NEXUS rotation (opus / codex / local 등) 만 사용하는 “베이직 모드”.
        </p>
      </header>
      <div className="mt-3 space-y-2">
        <label
          data-testid="chat-routing-auto"
          className="flex cursor-pointer items-start gap-3 rounded-md border border-border/60 p-3 hover:border-border"
          data-active={mounted && state.autoRouting ? 'true' : 'false'}
        >
          <input
            type="checkbox"
            checked={mounted ? state.autoRouting : DEFAULT_CHAT_ROUTING.autoRouting}
            onChange={(e) => toggleAuto(e.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">Automatic routing</span>
            <span className="text-xs text-muted-foreground">
              입력 중 mission router 가 plan / build / review / research / quick / vision 으로 자동 분류하고 chip 의 backend 를 실시간 변경. OFF (default) 시 chip 은 manual select 로만 작동.
            </span>
          </span>
        </label>
        <label
          data-testid="chat-routing-acp"
          className="flex cursor-pointer items-start gap-3 rounded-md border border-border/60 p-3 hover:border-border"
          data-active={mounted && state.acpBackends ? 'true' : 'false'}
        >
          <input
            type="checkbox"
            checked={mounted ? state.acpBackends : DEFAULT_CHAT_ROUTING.acpBackends}
            onChange={(e) => toggleAcp(e.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">ACP CLI backends</span>
            <span className="text-xs text-muted-foreground">
              OFF 시 Codex / Claude Code / Gemini CLI 가 chip picker 에서 사라지고 elanous-builtin 고정. NEXUS rotation (opus / codex / local 등) 만으로 단순화된 “베이직 모드”.
            </span>
          </span>
        </label>
      </div>
    </section>
  );
}
