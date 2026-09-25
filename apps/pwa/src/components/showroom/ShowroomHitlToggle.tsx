'use client';

// Round 3 PR2 (β-2 · 2026-05-08) — Showroom header HITL toggle.
//
// Vision Q1 — "데모 시 HITL 끄고 보여주고 싶다." Persisted in
// localStorage (`showroom.hitl.disabled`); PWA's createAgentCliSession
// reads the same key + appends ?hitl=off to /v1/agent-cli/sessions
// when the toggle is on.

import { useCallback, useEffect, useState } from 'react';
import {
  getShowroomHitlDisabled,
  setShowroomHitlDisabled,
  subscribeShowroomHitl,
} from '@/lib/showroom/hitl-toggle';

export function ShowroomHitlToggle() {
  const [disabled, setDisabled] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setDisabled(getShowroomHitlDisabled());
    const unsub = subscribeShowroomHitl(setDisabled);
    return () => { unsub(); };
  }, []);

  const toggle = useCallback(() => {
    setDisabled((prev) => {
      const next = !prev;
      setShowroomHitlDisabled(next);
      return next;
    });
  }, []);

  // SSR-safe: skeleton renders nothing until mount, so React doesn't
  // hydrate-mismatch when the localStorage value differs from default.
  if (!mounted) return null;

  return (
    <button
      type="button"
      onClick={toggle}
      data-testid="showroom-hitl-toggle"
      data-state={disabled ? 'off' : 'on'}
      title={
        disabled
          ? 'HITL prompts disabled for new agent sessions — click to re-enable'
          : 'HITL prompts active — click to disable for demo'
      }
      aria-pressed={!disabled}
      className={
        'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-mono '
        + (disabled
          ? 'border-zinc-300 bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
          : 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 dark:hover:bg-emerald-900/50')
      }
    >
      <span aria-hidden>{disabled ? '○' : '●'}</span>
      <span>HITL {disabled ? 'OFF' : 'ON'}</span>
    </button>
  );
}
