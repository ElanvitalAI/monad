'use client';

// PWA mirror PR 2 + PR 3 — Chat backend Quick Setup card.
//
// Mirrors the TUI Settings tab's Quick Setup card (g.2) for mobile /
// iOS / remote PWA users. PR 3 adds the refresh button (`r` key
// mirror) + chat backend swap dropdown (`global.chat.defaultBackend`
// switch via existing PUT /v1/config/switches/:id endpoint).
//
// Data source = GET /v1/nexus/chat-backend-detection (PR 1 endpoint).

import { useCallback, useEffect, useState } from 'react';
import type {
  ChatBackendDetection,
  ChatBackendEntry,
  ChatBackendKind,
} from '@/nexus/client';
import { useOptionalNexusClient } from '@/nexus/hooks/use-nexus-context';
import { Button } from '@/components/ui/button';

type CardState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; snapshot: ChatBackendDetection }
  | { status: 'error'; error: string };

type SwapState =
  | { status: 'idle' }
  | { status: 'mutating'; target: ChatBackendKind }
  | { status: 'error'; error: string };

const SWAP_OPTIONS: readonly { value: ChatBackendKind; label: string }[] = [
  { value: 'none',         label: 'none — auto-detect / Quick Setup 안내' },
  { value: 'codex',        label: 'codex — OpenAI Codex (OAuth or OPENAI_API_KEY)' },
  { value: 'claude-code',  label: 'claude-code — Anthropic (claude-code CLI 인증)' },
  { value: 'gemini',       label: 'gemini — Google (GEMINI_API_KEY)' },
];

export function QuickSetupCard() {
  const client = useOptionalNexusClient();
  const [state, setState] = useState<CardState>({ status: 'idle' });
  const [swap, setSwap] = useState<SwapState>({ status: 'idle' });
  // Hydration safety: SSR has no NexusProvider, so `client` is null
  // server-side. Returning `null` server-side and a `<section>`
  // client-side made React #418 (hydration mismatch). Defer the
  // null-check until after mount so the FIRST client render still
  // matches the SSR HTML (both render `null`); the second render
  // (post-effect) is a normal update, not a hydration step.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const refresh = useCallback(async () => {
    if (!client) return;
    setState({ status: 'loading' });
    try {
      const snapshot = await client.getChatBackendDetection();
      setState({ status: 'ok', snapshot });
    } catch (err) {
      setState({ status: 'error', error: (err as Error).message });
    }
  }, [client]);

  const swapBackend = useCallback(async (target: ChatBackendKind) => {
    if (!client) return;
    setSwap({ status: 'mutating', target });
    try {
      await client.putSwitch('global.chat.defaultBackend', { value: target });
      // Re-fetch so the displayed `detection.backend` reflects the
      // newly-saved switch (auto-detect runs on next NEXUS boot;
      // detection itself doesn't change because env / OAuth haven't —
      // but the user expects to see the chosen value reflected).
      await refresh();
      setSwap({ status: 'idle' });
    } catch (err) {
      setSwap({ status: 'error', error: (err as Error).message });
    }
  }, [client, refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // SSG-safe: NexusProvider 미mount (next build prerender) 시 silent hide.
  // Also pre-mount client guard above prevents hydration mismatch.
  if (!mounted || !client) return null;

  return (
    <section
      data-testid="quick-setup-card"
      className="rounded border border-border bg-card p-4 shadow-sm"
    >
      <header className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Quick Setup — chat 백엔드</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            chat 탭이 사용할 LLM 백엔드 1개만 셋업하면 됩니다. 데스크탑 NEXUS
            TUI Settings 탭과 같은 안내.
          </p>
        </div>
        <Button
          data-testid="quick-setup-refresh"
          variant="outline"
          size="sm"
          disabled={state.status === 'loading'}
          onClick={() => void refresh()}
          aria-label="detection 재실행"
          title="env / OAuth 재감지 (TUI 의 r 키 mirror)"
        >
          {state.status === 'loading' ? '…' : 'Refresh'}
        </Button>
      </header>

      {state.status === 'idle' && (
        <p className="text-xs text-muted-foreground">대기 중…</p>
      )}

      {state.status === 'loading' && (
        <p data-testid="quick-setup-loading" className="text-xs text-muted-foreground">
          detection 진행 중…
        </p>
      )}

      {state.status === 'error' && (
        <p data-testid="quick-setup-error" className="text-xs text-destructive">
          {state.error}
        </p>
      )}

      {state.status === 'ok' && (
        <CardBody
          snapshot={state.snapshot}
          swap={swap}
          onSwap={swapBackend}
        />
      )}
    </section>
  );
}

interface CardBodyProps {
  snapshot: ChatBackendDetection;
  swap: SwapState;
  onSwap: (target: ChatBackendKind) => void;
}

function CardBody({ snapshot, swap, onSwap }: CardBodyProps) {
  const wired = snapshot.detection.backend !== 'none';
  return (
    <div className="space-y-3 text-xs">
      <div data-testid="quick-setup-status">
        {wired ? (
          <span>
            현재 wired ·{' '}
            <code className="rounded bg-muted px-1 font-mono">
              {snapshot.detection.backend}
            </code>{' '}
            <span className="text-muted-foreground">({snapshot.detection.source})</span>
          </span>
        ) : (
          <span className="text-muted-foreground">
            현재 wired · (없음 — 아래 3 provider 중 1개 셋업)
          </span>
        )}
      </div>

      <ul className="space-y-2" data-testid="quick-setup-entries">
        {snapshot.entries.map((entry) => (
          <ProviderRow
            key={entry.provider}
            entry={entry}
            wired={snapshot.detection.backend === entry.provider}
          />
        ))}
      </ul>

      <div className="space-y-1 border-t border-border/40 pt-2">
        <label className="block text-[11px] text-muted-foreground" htmlFor="quick-setup-swap">
          Backend swap (`global.chat.defaultBackend` 변경)
        </label>
        <select
          id="quick-setup-swap"
          data-testid="quick-setup-swap"
          value={snapshot.detection.backend}
          disabled={swap.status === 'mutating'}
          onChange={(e) => onSwap(e.target.value as ChatBackendKind)}
          className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-xs shadow-xs focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {SWAP_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {swap.status === 'mutating' && (
          <p className="text-[11px] text-muted-foreground">
            적용 중 (target: <code>{swap.target}</code>)…
          </p>
        )}
        {swap.status === 'error' && (
          <p data-testid="quick-setup-swap-error" className="text-[11px] text-destructive">
            swap 실패 · {swap.error}
          </p>
        )}
        <p className="text-[11px] text-muted-foreground">
          새 chat 탭부터 적용 · 기존 chat 인스턴스는 per-tab override 또는
          재시작 시 반영. 변경은 즉시 NEXUS daemon 의 UserConfig 에 저장.
        </p>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Grok · 중국 4종 (kimi/qwen/glm/deepseek) 등은 NEXUS chat 우선순위
        외 — daemon 탭 또는 <code className="rounded bg-muted px-1">elanous legacy</code>{' '}
        에서 사용.
      </p>
    </div>
  );
}

function ProviderRow({
  entry,
  wired,
}: {
  entry: ChatBackendEntry;
  wired: boolean;
}) {
  return (
    <li
      data-testid={`quick-setup-provider-${entry.provider}`}
      data-wired={wired ? 'true' : 'false'}
      className="rounded border border-border/60 bg-background p-2"
    >
      <div className="flex items-center gap-2 font-medium">
        <span aria-hidden="true">{wired ? '▶' : ' '}</span>
        <span>{entry.label}</span>
      </div>
      <ul className="mt-1 space-y-1">
        {entry.paths.map((p) => (
          <li
            key={p.tag}
            data-testid={`quick-setup-path-${entry.provider}-${p.tag}`}
            data-detected={p.detected ? 'true' : 'false'}
            className="flex gap-2"
          >
            <span aria-label={p.detected ? 'detected' : 'missing'}>
              {p.detected ? '✓' : '◯'}
            </span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {p.tag}
            </span>
            <span className="text-[11px]">{p.hint}</span>
          </li>
        ))}
      </ul>
    </li>
  );
}
