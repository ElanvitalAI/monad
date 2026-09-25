'use client';

// RFC #2161 Phase 7 (2026-05-11) — Settings card for the registry
// catalog (Layer A) + resolved live state (Layer B).
//
// Shows the canonical provider list + per-provider model list grouped
// by family, with capability badges driven by the registry catalog.
// Refresh button triggers the on-demand discovery run (Phase 6) so
// the card stays current with the upstream `/v1/models` endpoints.
//
// Sibling card to ProviderCapabilityCard (legacy `/v1/providers` view).
// Phase 8 cleanup retires the legacy endpoint and lets this card take
// over the capability matrix display.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, ChevronDown, ChevronRight, Minus, RefreshCw } from 'lucide-react';
import { useDaemon } from '@/components/providers/DaemonProvider';
import { useResolvedView } from '@/lib/showroom/use-resolved-view';

const CAPABILITY_GLYPH: Record<string, string> = {
  skills: '🛠️',
  toolRestrictions: '🔒',
  structuredOutput: '📋',
  thinkingControl: '💭',
  effortControl: '⚙️',
  sessionResume: '↩️',
  mcp: '🧩',
  hooks: '🪝',
  agents: '🤖',
  envInjection: '🔑',
  costControl: '💰',
  fallbackModel: '🔁',
  sandbox: '🧱',
  multiHostFanout: '🌐',
};

interface DiscoveryRunStatus {
  state: 'idle' | 'running' | 'ok' | 'error';
  detail?: string;
}

type ViewMode = 'list' | 'matrix';

export function LlmCatalogCard() {
  const { client, config } = useDaemon();
  const view = useResolvedView(client);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [discoveryStatus, setDiscoveryStatus] = useState<DiscoveryRunStatus>({ state: 'idle' });
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  // FU A4 — capability matrix view derives the column set from the
  // first provider's capability map. All catalog providers ship the
  // same shape (PROVIDER_CAPABILITIES_NONE template), so the column
  // order stays stable.
  const capabilityKeys = useMemo<string[]>(() => {
    const first = view.providers[0];
    if (!first) return [];
    return Object.keys(first.capabilities).sort();
  }, [view.providers]);

  // Auto-collapse all providers on first paint so the card opens compact.
  useEffect(() => {
    if (view.providers.length > 0 && Object.keys(expanded).length === 0) {
      const init: Record<string, boolean> = {};
      for (const p of view.providers) init[p.id] = false;
      setExpanded(init);
    }
  }, [view.providers, expanded]);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const refresh = useCallback(async () => {
    setDiscoveryStatus({ state: 'running' });
    try {
      const url = `${config.baseUrl?.replace(/\/$/, '') ?? ''}/v1/registry/discovery`;
      const headers: Record<string, string> = {};
      if (config.token) headers.authorization = `Bearer ${config.token}`;
      const res = await fetch(url, { method: 'POST', headers });
      if (!res.ok) {
        setDiscoveryStatus({ state: 'error', detail: `HTTP ${res.status}` });
        return;
      }
      await view.reload();
      setDiscoveryStatus({ state: 'ok' });
    } catch (e) {
      setDiscoveryStatus({
        state: 'error',
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }, [config.baseUrl, config.token, view]);

  return (
    <section className="space-y-2" data-testid="llm-catalog-card">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-medium">LLM Catalog</h2>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span data-testid="llm-catalog-summary">
            {view.loading
              ? 'loading…'
              : `${view.providers.length} providers · ${view.models.length} models`}
          </span>
          <button
            type="button"
            onClick={() => setViewMode((m) => (m === 'list' ? 'matrix' : 'list'))}
            aria-label="Toggle view: list vs capability matrix"
            data-testid="llm-catalog-view-toggle"
            className="rounded px-1.5 py-0.5 text-[10px] uppercase font-medium hover:bg-surface-elevated"
          >
            {viewMode === 'list' ? 'matrix' : 'list'}
          </button>
          <button
            type="button"
            onClick={refresh}
            disabled={discoveryStatus.state === 'running' || view.loading}
            aria-label="Run discovery refresh"
            data-testid="llm-catalog-refresh"
            className="rounded p-1 hover:bg-surface-elevated disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${discoveryStatus.state === 'running' ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      {view.error && (
        <p className="flex items-center gap-1 text-[11px] text-error" data-testid="llm-catalog-error">
          <AlertCircle className="h-3 w-3" />
          {view.error}
        </p>
      )}
      {discoveryStatus.state === 'error' && (
        <p className="flex items-center gap-1 text-[11px] text-error">
          <AlertCircle className="h-3 w-3" />
          discovery failed · {discoveryStatus.detail}
        </p>
      )}
      {discoveryStatus.state === 'ok' && (
        <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
          discovery complete — catalog refreshed
        </p>
      )}

      {view.loading && view.providers.length === 0 && (
        <p className="text-[11px] text-muted-foreground">Querying /v1/registry/catalog…</p>
      )}

      {view.providers.length > 0 && viewMode === 'matrix' && (
        <div
          className="overflow-x-auto rounded-md border border-border"
          data-testid="llm-catalog-matrix"
        >
          <table className="min-w-full text-[10px]">
            <thead className="bg-surface-elevated">
              <tr>
                <th className="sticky left-0 z-10 bg-surface-elevated px-2 py-1 text-left font-medium">
                  Provider
                </th>
                {capabilityKeys.map((k) => (
                  <th
                    key={k}
                    className="px-1.5 py-1 text-center font-medium uppercase text-muted-foreground"
                    title={k}
                  >
                    {CAPABILITY_GLYPH[k] ?? k.slice(0, 3)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.providers.map((p) => (
                <tr
                  key={p.id}
                  className="border-t border-border/40"
                  data-testid={`llm-catalog-matrix-row-${p.id}`}
                >
                  <td className="sticky left-0 z-10 bg-card px-2 py-1 font-mono text-[10px]">
                    {p.id}
                  </td>
                  {capabilityKeys.map((k) => {
                    const v = (p.capabilities as Record<string, boolean>)[k];
                    return (
                      <td
                        key={k}
                        className="px-1.5 py-1 text-center"
                        title={`${p.id} · ${k}: ${v ? 'yes' : 'no'}`}
                      >
                        {v ? (
                          <Check className="mx-auto h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                        ) : (
                          <Minus className="mx-auto h-3 w-3 text-muted-foreground/50" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view.providers.length > 0 && viewMode === 'list' && (
        <ul
          className="space-y-1 rounded-md border border-border"
          data-testid="llm-catalog-provider-list"
        >
          {view.providers.map((p) => {
            const models = view.modelsByProvider(p.id);
            const isOpen = expanded[p.id] ?? false;
            const capFlags = Object.entries(p.capabilities)
              .filter(([, v]) => v === true)
              .map(([k]) => k);
            return (
              <li key={p.id} className="border-b border-border/40 last:border-0" data-testid={`llm-catalog-provider-${p.id}`}>
                <button
                  type="button"
                  onClick={() => toggle(p.id)}
                  aria-expanded={isOpen}
                  className="flex w-full items-start justify-between gap-2 px-2 py-1.5 text-left hover:bg-surface-elevated"
                  data-testid={`llm-catalog-provider-toggle-${p.id}`}
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-1.5 text-[12px] font-medium">
                      {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      <span>{p.displayName}</span>
                      <span className="rounded bg-muted px-1 font-mono text-[9px] uppercase text-muted-foreground">
                        {p.id}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-0.5 pl-4 text-[10px] text-muted-foreground">
                      {capFlags.map((k) => (
                        <span
                          key={k}
                          className="rounded bg-surface-elevated px-1"
                          title={k}
                        >
                          {CAPABILITY_GLYPH[k] ?? '·'} {k}
                        </span>
                      ))}
                    </div>
                  </div>
                  <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                    {models.length} model{models.length === 1 ? '' : 's'}
                  </span>
                </button>
                {isOpen && (
                  <ul
                    className="border-t border-border/40 bg-surface-elevated/50 px-2 py-1"
                    data-testid={`llm-catalog-models-${p.id}`}
                  >
                    {models.length === 0 && (
                      <li className="py-1 text-[10px] text-muted-foreground">
                        no models registered for this provider
                      </li>
                    )}
                    {models.map((m) => (
                      <li
                        key={m.id}
                        className="flex items-center justify-between gap-2 py-0.5 font-mono text-[10px]"
                        data-testid={`llm-catalog-model-${m.id}`}
                      >
                        <span className="truncate" title={m.id}>
                          {m.id}
                        </span>
                        <span className="shrink-0 text-muted-foreground">
                          {m.contextSize ? `${Math.round(m.contextSize / 1000)}k ctx` : '—'}
                          {m.pricing
                            ? ` · $${m.pricing.inputPerMTok}/$${m.pricing.outputPerMTok}`
                            : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
