'use client';

// §3.6 (2026-05-10) — Settings card consumer for FU.A3 multi-host
// hot-reload (#2118). Lets users add/remove Anthropic / Gemini / vLLM
// / Ollama hosts at runtime without editing `ELANOUS_LLM_HOSTS` JSON.
//
// Architecture (from BACKLOG §3.6 + FU.A3):
//   - GET  /v1/llm/hosts → list with `source: 'override'|'env'|'legacy'`.
//     `apiKey` is `[redacted]` on the wire — daemon-side guard against
//     accidental exposure in DevTools / screenshots.
//   - PUT  /v1/llm/hosts (full replace) → installs an in-memory override
//     for the daemon's host resolver. Restart reverts to env / legacy.
//   - DELETE /v1/llm/hosts → clear override.
//
// Limitation worth surfacing in the UI: PUT is full-replace, and the
// existing Anthropic apiKey shows up as `[redacted]` on GET — meaning
// we can't preserve it across an Add/Remove without asking the user
// to re-enter. Hint text spells this out so dogfood doesn't surprise.

import { useCallback, useEffect, useState } from 'react';
import { useDaemon } from '@/components/providers/DaemonProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import {
  type LlmHostConfig,
  type LlmHostKind,
  type LlmHostsResponse,
} from '@/lib/daemon-client';

// RFC #2161 Phase 4 — `'anthropic'` kind renamed to
// `'anthropic-openai-wrap'` so it's clearly distinguished from the
// canonical 'anthropic' provider in the registry catalog. The daemon
// still accepts the legacy alias for one release with a deprecation
// warning surfaced via the GET response's `deprecations` field.
const KIND_OPTIONS: ReadonlyArray<LlmHostKind> = [
  'lm-studio',
  'vllm',
  'ollama',
  'anthropic-openai-wrap',
];

const KIND_DEFAULT_ENDPOINT: Record<LlmHostKind, string> = {
  'lm-studio': 'http://localhost:1234',
  vllm: 'http://localhost:8000',
  ollama: 'http://localhost:11434',
  'anthropic-openai-wrap': 'https://api.anthropic.com',
};

interface CardState {
  status: 'idle' | 'loading' | 'ok' | 'error';
  data?: LlmHostsResponse;
  error?: string;
}

export function LlmHostsCard() {
  const { client, config } = useDaemon();
  const [state, setState] = useState<CardState>({ status: 'idle' });
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<LlmHostKind>('anthropic-openai-wrap');
  const [endpoint, setEndpoint] = useState(KIND_DEFAULT_ENDPOINT['anthropic-openai-wrap']);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!config.baseUrl) {
      setState({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    void (async () => {
      try {
        const res = await client.getLlmHosts();
        if (!cancelled) setState({ status: 'ok', data: res });
      } catch (e) {
        if (!cancelled) {
          setState({
            status: 'error',
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, config.baseUrl, refreshNonce]);

  const refresh = useCallback(() => setRefreshNonce((n) => n + 1), []);

  const onKindChange = useCallback((next: LlmHostKind) => {
    setKind(next);
    setEndpoint(KIND_DEFAULT_ENDPOINT[next]);
  }, []);

  const handleAdd = useCallback(async () => {
    const cleanName = name.trim();
    const cleanEndpoint = endpoint.trim();
    const cleanKey = apiKey.trim();
    if (!cleanName || !cleanEndpoint) {
      toast.error('name + endpoint 필수');
      return;
    }
    if (kind === 'anthropic-openai-wrap' && !cleanKey) {
      toast.error('Anthropic 은 apiKey 필수');
      return;
    }
    setBusy(true);
    try {
      const current = state.data?.hosts ?? [];
      // Strip `apiKey: '[redacted]'` markers so daemon validation
      // doesn't reject — we lose existing Anthropic keys here, which
      // the hint text below warns about.
      const next: LlmHostConfig[] = [
        ...current
          .filter((h) => h.name !== cleanName)
          .map((h) => {
            const base: LlmHostConfig = {
              name: h.name,
              kind: h.kind,
              endpoint: h.endpoint,
            };
            if (h.apiKey && h.apiKey !== '[redacted]') {
              base.apiKey = h.apiKey;
            }
            return base;
          }),
        {
          name: cleanName,
          kind,
          endpoint: cleanEndpoint,
          ...(cleanKey ? { apiKey: cleanKey } : {}),
        },
      ];
      await client.setLlmHosts(next);
      toast.success(`host '${cleanName}' 추가됨`);
      setName('');
      setApiKey('');
      setShowAdd(false);
      refresh();
    } catch (e) {
      toast.error(`추가 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [client, name, kind, endpoint, apiKey, state.data, refresh]);

  const handleRemove = useCallback(
    async (target: string) => {
      setBusy(true);
      try {
        const current = state.data?.hosts ?? [];
        const next: LlmHostConfig[] = current
          .filter((h) => h.name !== target)
          .map((h) => {
            const base: LlmHostConfig = {
              name: h.name,
              kind: h.kind,
              endpoint: h.endpoint,
            };
            if (h.apiKey && h.apiKey !== '[redacted]') {
              base.apiKey = h.apiKey;
            }
            return base;
          });
        await client.setLlmHosts(next);
        toast.success(`host '${target}' 제거됨`);
        refresh();
      } catch (e) {
        toast.error(`제거 실패: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setBusy(false);
      }
    },
    [client, state.data, refresh],
  );

  const handleReset = useCallback(async () => {
    setBusy(true);
    try {
      await client.clearLlmHosts();
      toast.success('env / legacy 로 환원');
      refresh();
    } catch (e) {
      toast.error(`reset 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [client, refresh]);

  if (!config.baseUrl) return null;

  const data = state.data;
  const sourceBadgeClass =
    data?.source === 'override'
      ? 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900 dark:text-fuchsia-200'
      : data?.source === 'env'
        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200'
        : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300';

  return (
    <section className="space-y-2" data-testid="llm-hosts-card">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-medium">LLM Hosts</h2>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {data && (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${sourceBadgeClass}`}
              data-testid="llm-hosts-source-badge"
            >
              {data.source}
            </span>
          )}
          <span data-testid="llm-hosts-count">
            {data
              ? `${data.count} host${data.count === 1 ? '' : 's'}`
              : state.status === 'loading'
                ? 'loading…'
                : ''}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={state.status === 'loading' || busy}
            data-testid="llm-hosts-refresh"
          >
            Refresh
          </Button>
        </div>
      </header>

      <div className="rounded-md border border-border bg-card p-3 text-xs space-y-2">
        {/* RFC #2161 Phase 4 — server flags legacy `'anthropic'` kind
            usage. Yellow banner so users migrate before the next
            release removes the alias. */}
        {data?.deprecations && data.deprecations.length > 0 && (
          <div
            className="rounded border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200"
            data-testid="llm-hosts-deprecations"
          >
            <p className="font-medium">호환성 경고 · 다음 release 에서 제거 예정</p>
            <ul className="ml-4 list-disc">
              {data.deprecations.map((msg) => (
                <li key={msg} className="font-mono text-[10px]">
                  {msg}
                </li>
              ))}
            </ul>
          </div>
        )}
        {state.status === 'error' && (
          <p className="text-rose-500" data-testid="llm-hosts-error">
            조회 실패 · {state.error}
          </p>
        )}
        {state.status === 'loading' && !data && (
          <p className="text-muted-foreground">Probing /v1/llm/hosts…</p>
        )}
        {data && data.hosts.length === 0 && (
          <p className="text-muted-foreground">
            No hosts configured. Add one below to enable a remote LLM provider
            (e.g. Anthropic / Gemini API direct).
          </p>
        )}
        {data && data.hosts.length > 0 && (
          <ul className="space-y-1" data-testid="llm-hosts-list">
            {data.hosts.map((h) => (
              <li
                key={h.name}
                className="flex items-center gap-2 rounded border border-border bg-muted/30 px-2 py-1"
                data-testid={`llm-host-row-${h.name}`}
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center gap-1.5 font-mono text-[11px] font-medium">
                    <span>{h.name}</span>
                    <span className="rounded bg-muted px-1 text-[9px] uppercase text-muted-foreground">
                      {h.kind}
                    </span>
                    {h.apiKey === '[redacted]' && (
                      <span
                        className="rounded bg-emerald-100 px-1 text-[9px] uppercase text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200"
                        title="apiKey configured (server-side, not echoed)"
                        data-testid={`llm-host-key-badge-${h.name}`}
                      >
                        key
                      </span>
                    )}
                  </div>
                  <div className="truncate font-mono text-[10px] text-muted-foreground">
                    {h.endpoint}
                  </div>
                </div>
                {data.source === 'override' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void handleRemove(h.name);
                    }}
                    disabled={busy}
                    data-testid={`llm-host-remove-${h.name}`}
                  >
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            size="sm"
            onClick={() => setShowAdd((v) => !v)}
            disabled={busy}
            data-testid="llm-hosts-add-toggle"
          >
            {showAdd ? 'Cancel add' : 'Add host'}
          </Button>
          {data?.source === 'override' && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void handleReset();
              }}
              disabled={busy}
              data-testid="llm-hosts-reset"
            >
              Reset to env/legacy
            </Button>
          )}
        </div>

        {showAdd && (
          <div
            className="mt-2 space-y-1.5 rounded border border-dashed border-border p-2"
            data-testid="llm-hosts-add-form"
          >
            <Input
              value={name}
              placeholder="name (e.g. anthropic-cloud)"
              onChange={(e) => setName(e.target.value)}
              data-testid="llm-hosts-add-name"
              className="text-[11px]"
            />
            <select
              value={kind}
              onChange={(e) => onKindChange(e.target.value as LlmHostKind)}
              className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
              data-testid="llm-hosts-add-kind"
            >
              {KIND_OPTIONS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <Input
              value={endpoint}
              placeholder="endpoint URL"
              onChange={(e) => setEndpoint(e.target.value)}
              data-testid="llm-hosts-add-endpoint"
              className="text-[11px]"
            />
            {kind === 'anthropic-openai-wrap' && (
              <Input
                type="password"
                value={apiKey}
                placeholder="apiKey (sk-ant-…)"
                onChange={(e) => setApiKey(e.target.value)}
                data-testid="llm-hosts-add-apikey"
                className="text-[11px]"
              />
            )}
            <Button
              size="sm"
              onClick={() => {
                void handleAdd();
              }}
              disabled={busy || !name.trim() || !endpoint.trim()}
              data-testid="llm-hosts-add-submit"
            >
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground">
        In-memory override · daemon restart reverts to <code className="rounded bg-muted px-1">ELANOUS_LLM_HOSTS</code> env / legacy single host. Permanent change → set the env var in <code className="rounded bg-muted px-1">.zshrc</code> or <code className="rounded bg-muted px-1">launchctl setenv</code>. PUT replaces the full list, so re-add Anthropic/Gemini hosts in one go (existing apiKeys appear as <code className="rounded bg-muted px-1">[redacted]</code> and aren&rsquo;t round-trippable).
      </p>
    </section>
  );
}
