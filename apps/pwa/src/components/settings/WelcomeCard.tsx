'use client';

// PWA mirror PR 4 — first-boot welcome card.
//
// Mirrors the TUI chat-tab welcome card (g.3) for mobile / iOS /
// remote PWA users. Single source of truth for the dismiss flag is
// the `global.nexus.firstBootGuideShown` switch (added in this PR
// alongside the React component). TUI dismisses via Esc on a chat
// tab whose backend resolved to 'none'; PWA dismisses via the
// "Got it" button below. Both write the same UserConfig file →
// the other surface auto-hides on next read.
//
// Read path:
//   1. Mount → useNexusClient.getSwitch('global.nexus.firstBootGuideShown')
//   2. value === true → don't render
//   3. value === false / undefined → render the card
//
// Dismiss path:
//   - Click "Got it" → putSwitch(...) with value=true
//   - On success → setVisible(false) optimistic + final fetch confirms

import { useCallback, useEffect, useState } from 'react';
import { useOptionalNexusClient } from '@/nexus/hooks/use-nexus-context';
import { Button } from '@/components/ui/button';

const SWITCH_ID = 'global.nexus.firstBootGuideShown';

type CardState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'shown' }
  | { status: 'hidden' }
  | { status: 'error'; error: string };

export function WelcomeCard() {
  const client = useOptionalNexusClient();
  const [state, setState] = useState<CardState>({ status: 'idle' });
  const [dismissing, setDismissing] = useState(false);
  // Hydration safety — see QuickSetupCard (PR #1866) for the same pattern.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const refresh = useCallback(async () => {
    if (!client) return;
    setState({ status: 'loading' });
    try {
      const res = await client.getSwitch(SWITCH_ID);
      const dismissed = res.switch.value === true;
      setState({ status: dismissed ? 'hidden' : 'shown' });
    } catch (err) {
      // Switch lookup failure (NEXUS HTTP not running, network glitch)
      // → don't surface a noisy error to first-boot users; just hide.
      // Production NEXUS always has the switch wired so this is rare.
      setState({ status: 'error', error: (err as Error).message });
    }
  }, [client]);

  const dismiss = useCallback(async () => {
    if (!client) return;
    setDismissing(true);
    try {
      await client.putSwitch(SWITCH_ID, { value: true });
      setState({ status: 'hidden' });
    } catch (err) {
      setState({ status: 'error', error: (err as Error).message });
    } finally {
      setDismissing(false);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // SSG-safe: NexusProvider 미mount 일 때 (next build prerender · baseUrl
  // 비어있을 때) silent hide. browser hydrate 후 baseUrl 셋업 시 자동 표시.
  // Mount guard prevents the SSR=null vs CSR=<section> hydration mismatch.
  if (!mounted || !client) return null;

  // 'idle' / 'loading' / 'hidden' / 'error' → render nothing (the
  // card only appears for users who haven't dismissed yet). Error
  // case is silent on purpose — see refresh() comment above.
  if (state.status !== 'shown') return null;

  return (
    <section
      data-testid="welcome-card"
      className="rounded border border-primary/30 bg-primary/5 p-4 shadow-sm"
    >
      <header className="mb-2 flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold">✦ Welcome to elanous NEXUS</h3>
        <Button
          data-testid="welcome-card-dismiss"
          variant="ghost"
          size="sm"
          disabled={dismissing}
          onClick={() => void dismiss()}
          aria-label="환영 카드 닫기"
        >
          {dismissing ? '…' : 'Got it'}
        </Button>
      </header>
      <div className="space-y-2 text-xs text-muted-foreground">
        <p>
          모바일 / iOS / 원격에서도 같은 NEXUS 에 접속 — 데스크탑 TUI 와
          이 PWA 는 같은 daemon 의 두 surface (UserConfig SSoT 공유).
        </p>
        <p>
          Chat 백엔드를 셋업하지 않았다면 위의 <strong>Quick Setup</strong>{' '}
          카드에서 1개만 선택하면 됩니다.
        </p>
        <p>
          Telegram · Discord allowlist · 자동 부팅 (launchd / systemd) 등{' '}
          <em>advanced 셋업</em>은 데스크탑에서{' '}
          <span className="font-mono">elanous legacy</span> →{' '}
          <span className="font-mono">/setup</span> wizard 에서 셋업
          (NEXUS 미mirror 영역).
        </p>
        <p>
          <span className="font-mono">[Got it]</span>{' '}
          한 번 누르면 다음부터 안 보입니다 (TUI 와 동기화).
        </p>
      </div>
    </section>
  );
}
