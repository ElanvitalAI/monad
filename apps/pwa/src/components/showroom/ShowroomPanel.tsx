'use client';

/** CV-3 Showroom MVP — chat / agent panel view.
 *  ([RFC v4](../../../../../내부 문서 `PLAN-cv-3-showroom-mvp-2026-05-07`))
 *
 *  DM stage 3 (본 PR · 후속 #1956 → #1983) — panels are pure viewers of
 *  layout-owned state (`dmState`). All multi-LLM dispatch flows through
 *  the layout-level single ACP (DM stage 1 chat targets · DM stage 2
 *  agent targets via daemon dual-role manager). The legacy P1-P4
 *  panel-local ACP path was removed.
 */

import { useCallback, useMemo, useState } from 'react';
import { Bot, Forward, GitFork, Sparkles, Tag, Volume2, VolumeX, X } from 'lucide-react';
import type { DaemonClient } from '@/lib/daemon-client';
import type { ChatMessage } from '@/lib/chat-runtime';
import {
  formatToolListEntry,
  panelDisplayName,
  SHOWROOM_PROVIDERS,
  type AddChainEdgeFail,
  type AddChainEdgeOk,
  type AddChainEdgeOpts,
} from '@/lib/showroom/runtime';
import { useResolvedView } from '@/lib/showroom/use-resolved-view';
import { usePersonas, type PersonaWire } from '@/lib/showroom/use-personas';
import type {
  ChainEdge,
  ShowroomPanel,
  ShowroomPanelState,
  ShowroomRoleHint,
  ToolCallState,
} from '@/lib/showroom/types';

const ROLE_HINT_OPTIONS: readonly ShowroomRoleHint[] = [
  'plan',
  'exec',
  'review',
  'reflect',
];

const ROLE_HINT_LABEL: Record<ShowroomRoleHint, string> = {
  plan: 'plan',
  exec: 'exec',
  review: 'review',
  reflect: 'reflect',
};

interface Props {
  panel: ShowroomPanel;
  allPanels: readonly ShowroomPanel[];
  client: DaemonClient;
  onClose: () => void;
  onState: (state: ShowroomPanelState) => void;
  onProvider: (provider: string) => void;
  /** DM-3 — assistant message 의 prior-answer promotion. parent 가
   *  Showroom-level priorAnswers state 에 추가 · 다음 broadcast 시
   *  prompt prefix 로 prepend. */
  onPromoteAssistant?: (payload: { messageId: string; text: string }) => void;
  /** §6.7 — agent-to-agent direct routing chain edges. outgoingEdges
   *  = 본 panel 에서 출발하는 edges (panel header 의 chain pill 리스트
   *  에 표시). 동시에 본 props 들이 모두 정의된 경우만 chain UI 진입
   *  (parent 가 lazy 활성화 가능). */
  outgoingEdges?: readonly ChainEdge[];
  onAddChainEdge?: (
    fromPanelId: string,
    toPanelId: string,
    opts?: AddChainEdgeOpts,
  ) => AddChainEdgeOk | AddChainEdgeFail;
  onRemoveChainEdge?: (edgeId: string) => void;
  /** D3 (2026-05-11) — flip the HITL gate flag on an existing edge.
   *  When `hitl === true`, the layout's finalize watcher enqueues a
   *  confirm modal instead of firing autoForwardToPanel directly. */
  onToggleChainEdgeHitl?: (edgeId: string) => void;
  /** §6.1 — set/clear panel role hint. null = clear. */
  onRoleHint?: (role: ShowroomRoleHint | null) => void;
  /** §6.4 — set/clear panel persona binding. null = clear. */
  onPersona?: (persona: { personaId: string; brand?: string } | null) => void;
  /** DM stage 3 — externalized panel state owned by ShowroomLayout's
   *  layout-level ACP (single session · namespaced per modelId).
   *  DM stage 3 FU (HANDOFF §3.2 · 2026-05-09) added `toolCalls`. */
  dmState?: {
    messages: ChatMessage[];
    partial: string;
    streaming: boolean;
    error: string | null;
    toolCalls?: Record<string, ToolCallState>;
  };
  /** DM stage 3 — layout-level sessionId · same across all panels in
   *  the showroom (single ACP). Surfaced in footer breadcrumb. */
  dmSessionId?: string | null;
}

export function ShowroomPanelView({
  panel,
  allPanels,
  client,
  onClose,
  onState,
  onProvider,
  onPromoteAssistant,
  outgoingEdges,
  onAddChainEdge,
  onRemoveChainEdge,
  onToggleChainEdgeHitl,
  onRoleHint,
  onPersona,
  dmState,
  dmSessionId,
}: Props) {
  const [chainPickerOpen, setChainPickerOpen] = useState(false);
  const [chainAddError, setChainAddError] = useState<string | null>(null);
  const [rolePickerOpen, setRolePickerOpen] = useState(false);
  const [personaPickerOpen, setPersonaPickerOpen] = useState(false);
  const personasResult = usePersonas(client);
  const personas = personasResult.personas;
  // RFC #2161 Phase 3 — provider dropdown is registry-driven now. Falls
  // back to the static SHOWROOM_PROVIDERS array when the catalog hasn't
  // loaded yet (or fetched fails) so the picker stays usable offline.
  const resolvedView = useResolvedView(client);
  const providerOptions = useMemo<readonly string[]>(() => {
    if (resolvedView.providerIds.length === 0) return SHOWROOM_PROVIDERS;
    // Layer A canonical ids · keep the leading '' option so '(default)'
    // stays selectable. Append any legacy aliases the user already has
    // selected (e.g. an existing panel with provider='claude') so the
    // current selection never disappears mid-session.
    const ids = ['', ...resolvedView.providerIds];
    if (panel.provider && !ids.includes(panel.provider)) ids.push(panel.provider);
    return ids;
  }, [resolvedView.providerIds, panel.provider]);
  const boundPersona: PersonaWire | undefined = useMemo(() => {
    if (!panel.personaId) return undefined;
    return personas.find((p) => p.personaId === panel.personaId);
  }, [panel.personaId, personas]);
  // Q3 Hybrid — when bound persona has explicit brand, provider picker
  // is locked (the persona's authored intent is preserved).
  const providerLocked = !!boundPersona?.brand;

  const chainEnabled =
    !!onAddChainEdge && !!onRemoveChainEdge && !!outgoingEdges;
  const outgoing = outgoingEdges ?? [];

  // §6.7 — picker shows other panels not yet routed from this panel.
  const chainTargetCandidates = useMemo(
    () =>
      allPanels.filter(
        (p) =>
          p.id !== panel.id
          && !outgoing.some((e) => e.toPanelId === p.id),
      ),
    [allPanels, panel.id, outgoing],
  );

  const handleAddRoute = useCallback(
    (toPanelId: string) => {
      if (!onAddChainEdge) return;
      const result = onAddChainEdge(panel.id, toPanelId);
      if (!result.ok) {
        setChainAddError(`route rejected · ${result.reason}`);
        return;
      }
      setChainAddError(null);
      setChainPickerOpen(false);
    },
    [onAddChainEdge, panel.id],
  );
  // DM stage 3 — panel renders directly from layout-owned state. The
  // ShowroomLayout's single ACP fans out updates via the multi-LLM
  // bridge (DM stage 1 chat · DM stage 2 agent) and routes them per
  // modelId into `dmPanelStates`, which the parent passes here.
  const messages = dmState?.messages ?? [];
  const partial = dmState?.partial ?? '';
  const streaming = dmState?.streaming ?? false;
  const error = dmState?.error ?? null;
  // DM stage 3 FU — sorted (oldest first · stable order) snapshot of
  // the per-panel tool_call lifecycle. Drives the activity pill + the
  // expandable list. See HANDOFF §3.2 + ShowroomPanel TODOs (244+397).
  const toolCalls = useMemo<readonly ToolCallState[]>(
    () => {
      const map = dmState?.toolCalls;
      if (!map) return [];
      return Object.values(map).sort((a, b) => a.startedAt - b.startedAt);
    },
    [dmState?.toolCalls],
  );
  const runningToolCount = useMemo(
    () =>
      toolCalls.filter(
        (t) => t.status === 'pending' || t.status === 'in_progress',
      ).length,
    [toolCalls],
  );
  const [toolListOpen, setToolListOpen] = useState(false);

  const onToggleMute = useCallback(() => {
    onState(panel.state === 'live' ? 'mute' : 'live');
  }, [panel.state, onState]);

  const displayName = useMemo(
    () => panelDisplayName(panel, allPanels),
    [panel, allPanels],
  );

  const stateClass =
    panel.state === 'live'
      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
      : panel.state === 'mute'
        ? 'bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300'
        : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';

  return (
    <article
      className={`flex h-full min-h-0 min-w-0 flex-1 flex-col rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900 ${
        panel.state === 'mute' ? 'opacity-60' : ''
      }`}
      data-testid={`showroom-panel-${panel.id}`}
      aria-label={`Showroom panel ${displayName}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200/50 px-3 py-2 dark:border-zinc-700/50">
        <div className="flex items-center gap-2 text-xs">
          {panel.kind === 'agent' && (
            <span
              className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] uppercase text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
              data-testid={`showroom-panel-agent-badge-${panel.id}`}
              title={`agent CLI · brand=${panel.agentBrand}`}
            >
              <Bot className="size-3" aria-hidden />
              agent
            </span>
          )}
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            @{displayName}
          </span>
          <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${stateClass}`}>
            {panel.state}
          </span>
          {onPersona && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setPersonaPickerOpen((v) => !v)}
                className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] uppercase ${
                  boundPersona
                    ? 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/40 dark:text-fuchsia-300'
                    : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
                }`}
                aria-label={
                  boundPersona
                    ? `Persona: ${boundPersona.displayName}`
                    : 'Bind persona'
                }
                title={
                  boundPersona
                    ? `Persona: ${boundPersona.displayName} — click to change`
                    : 'Bind a persona (system prompt + brand lock)'
                }
                data-testid={`showroom-panel-persona-toggle-${panel.id}`}
                style={
                  boundPersona?.brandColor
                    ? { borderLeft: `3px solid ${boundPersona.brandColor}` }
                    : undefined
                }
              >
                <Sparkles className="size-3" aria-hidden />
                {boundPersona ? boundPersona.displayName.slice(0, 12) : 'persona'}
              </button>
              {personaPickerOpen && (
                <div
                  className="absolute left-0 top-full z-20 mt-1 w-64 max-h-72 overflow-y-auto rounded-md border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
                  data-testid={`showroom-panel-persona-menu-${panel.id}`}
                >
                  {personasResult.loading && (
                    <p className="px-1.5 py-1 text-[10px] text-zinc-500">loading…</p>
                  )}
                  {personasResult.error && (
                    <p className="px-1.5 py-1 text-[10px] text-rose-600">
                      error: {personasResult.error}
                    </p>
                  )}
                  {!personasResult.loading && personas.length === 0 && (
                    <p className="px-1.5 py-1 text-[10px] text-zinc-500">
                      no personas (yaml in <code>~/.monad/personas/</code>)
                    </p>
                  )}
                  {personas.map((p) => {
                    const selected = p.personaId === panel.personaId;
                    return (
                      <button
                        key={p.personaId}
                        type="button"
                        onClick={() => {
                          onPersona(
                            p.brand
                              ? { personaId: p.personaId, brand: p.brand }
                              : { personaId: p.personaId },
                          );
                          setPersonaPickerOpen(false);
                        }}
                        className={`block w-full rounded px-1.5 py-1 text-left text-[11px] hover:bg-fuchsia-50 dark:hover:bg-fuchsia-900/20 ${
                          selected ? 'font-bold text-fuchsia-700 dark:text-fuchsia-300' : ''
                        }`}
                        data-testid={`showroom-panel-persona-set-${panel.id}-${p.personaId}`}
                      >
                        <span
                          className="mr-1 inline-block size-2 rounded-full"
                          style={p.brandColor ? { backgroundColor: p.brandColor } : { backgroundColor: '#a1a1aa' }}
                          aria-hidden
                        />
                        {p.displayName}
                        {p.brand && (
                          <span className="ml-1 text-[9px] uppercase text-zinc-500">
                            {p.brand}
                          </span>
                        )}
                      </button>
                    );
                  })}
                  {boundPersona && (
                    <button
                      type="button"
                      onClick={() => {
                        onPersona(null);
                        setPersonaPickerOpen(false);
                      }}
                      className="mt-1 block w-full rounded border-t border-zinc-100 px-1.5 py-1 text-left text-[11px] text-rose-600 hover:bg-rose-50 dark:border-zinc-800 dark:text-rose-400 dark:hover:bg-rose-900/20"
                      data-testid={`showroom-panel-persona-clear-${panel.id}`}
                    >
                      clear
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {onRoleHint && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setRolePickerOpen((v) => !v)}
                className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] uppercase ${
                  panel.roleHint
                    ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300'
                    : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
                }`}
                aria-label={panel.roleHint ? `Role: ${panel.roleHint}` : 'Set role hint'}
                title={
                  panel.roleHint
                    ? `Role: ${panel.roleHint} — click to change`
                    : 'Assign role hint (auto @target)'
                }
                data-testid={`showroom-panel-role-toggle-${panel.id}`}
              >
                <Tag className="size-3" aria-hidden />
                {panel.roleHint ?? 'role'}
              </button>
              {rolePickerOpen && (
                <div
                  className="absolute left-0 top-full z-20 mt-1 w-32 rounded-md border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
                  data-testid={`showroom-panel-role-menu-${panel.id}`}
                >
                  {ROLE_HINT_OPTIONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => {
                        onRoleHint(r);
                        setRolePickerOpen(false);
                      }}
                      className={`block w-full rounded px-1.5 py-1 text-left text-[11px] hover:bg-violet-50 dark:hover:bg-violet-900/20 ${
                        panel.roleHint === r ? 'font-bold text-violet-700 dark:text-violet-300' : ''
                      }`}
                      data-testid={`showroom-panel-role-set-${panel.id}-${r}`}
                    >
                      {ROLE_HINT_LABEL[r]}
                    </button>
                  ))}
                  {panel.roleHint && (
                    <button
                      type="button"
                      onClick={() => {
                        onRoleHint(null);
                        setRolePickerOpen(false);
                      }}
                      className="mt-1 block w-full rounded border-t border-zinc-100 px-1.5 py-1 text-left text-[11px] text-rose-600 hover:bg-rose-50 dark:border-zinc-800 dark:text-rose-400 dark:hover:bg-rose-900/20"
                      data-testid={`showroom-panel-role-clear-${panel.id}`}
                    >
                      clear
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {streaming && (
            <span className="text-[10px] text-zinc-500" aria-live="polite">
              streaming…
            </span>
          )}
          {/* DM stage 3 FU (HANDOFF §3.2 · 2026-05-09) — re-added the
              activity pill after the multi-llm-bridge began forwarding
              `tool_call` / `tool_call_update` events with
              `_meta.monad.toolCall`. Click toggles a list under the
              header (rendered in the message body section). */}
          {toolCalls.length > 0 && (
            <button
              type="button"
              onClick={() => setToolListOpen((v) => !v)}
              aria-expanded={toolListOpen}
              aria-controls={`showroom-panel-tools-${panel.id}`}
              data-testid={`showroom-panel-tools-pill-${panel.id}`}
              title={
                runningToolCount > 0
                  ? `${toolCalls.length} tool calls · ${runningToolCount} running`
                  : `${toolCalls.length} tool calls`
              }
              className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
                runningToolCount > 0
                  ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                  : 'border-zinc-300 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
              }`}
            >
              <span aria-hidden>⚙</span>
              <span>
                {toolCalls.length} tool{toolCalls.length === 1 ? '' : 's'}
                {runningToolCount > 0 ? ` · ${runningToolCount} running` : ''}
              </span>
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          {panel.kind === 'agent' ? (
            <span
              className="rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
              data-testid={`showroom-panel-brand-${panel.id}`}
              title="Agent CLI brand is locked at create time (P5 D6)"
            >
              {panel.agentBrand}-cli
            </span>
          ) : (
            <select
              value={panel.provider}
              onChange={(e) => onProvider(e.target.value)}
              disabled={streaming || providerLocked}
              className="rounded-md border border-zinc-300 bg-white px-1.5 py-0.5 text-xs disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800"
              aria-label="Provider"
              title={
                providerLocked
                  ? `Provider locked by persona "${boundPersona?.displayName}" (brand=${boundPersona?.brand})`
                  : 'Provider'
              }
              data-testid={`showroom-panel-provider-${panel.id}`}
            >
              {providerOptions.map((p) => (
                <option key={p} value={p}>
                  {p || '(default)'}
                </option>
              ))}
            </select>
          )}
          {chainEnabled && (
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setChainPickerOpen((v) => !v);
                  setChainAddError(null);
                }}
                className="relative rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                aria-label="Forward chain · agent-to-agent direct routing"
                title={
                  outgoing.length > 0
                    ? `Chain: forwards to ${outgoing.length} panel(s)`
                    : 'Set up auto-forward to another panel'
                }
                data-testid={`showroom-panel-chain-toggle-${panel.id}`}
              >
                <GitFork className="size-3.5" aria-hidden />
                {outgoing.length > 0 && (
                  <span
                    className="absolute -right-0.5 -top-0.5 flex size-3.5 items-center justify-center rounded-full bg-indigo-500 text-[8px] font-bold text-white"
                    aria-hidden
                  >
                    {outgoing.length}
                  </span>
                )}
              </button>
              {chainPickerOpen && (
                <div
                  className="absolute right-0 top-full z-20 mt-1 w-56 rounded-md border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
                  data-testid={`showroom-panel-chain-menu-${panel.id}`}
                >
                  <p className="mb-1 text-[10px] uppercase text-zinc-500">
                    Auto-forward to
                  </p>
                  {outgoing.length > 0 && (
                    <ul className="mb-2 space-y-0.5 border-b border-zinc-100 pb-2 dark:border-zinc-800">
                      {outgoing.map((edge) => {
                        const tp = allPanels.find((p) => p.id === edge.toPanelId);
                        const tpLabel = tp ? panelDisplayName(tp, allPanels) : edge.toPanelId;
                        return (
                          <li
                            key={edge.id}
                            className="flex items-center justify-between gap-1 rounded bg-indigo-50 px-1.5 py-1 text-[11px] dark:bg-indigo-900/30"
                            data-testid={`showroom-panel-chain-edge-${edge.id}`}
                          >
                            <span className="truncate text-indigo-700 dark:text-indigo-300">
                              → @{tpLabel}
                            </span>
                            <div className="flex shrink-0 items-center gap-0.5">
                              {onToggleChainEdgeHitl && (
                                <button
                                  type="button"
                                  onClick={() => onToggleChainEdgeHitl(edge.id)}
                                  className={`rounded p-0.5 text-[11px] leading-none ${
                                    edge.hitl
                                      ? 'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:hover:bg-amber-900/60'
                                      : 'text-indigo-500/60 hover:bg-indigo-100 dark:hover:bg-indigo-800/40'
                                  }`}
                                  aria-pressed={!!edge.hitl}
                                  aria-label={
                                    edge.hitl
                                      ? `Disable confirm gate for forward to @${tpLabel}`
                                      : `Enable confirm gate for forward to @${tpLabel}`
                                  }
                                  title={
                                    edge.hitl
                                      ? 'Confirm before forward (click to auto-forward)'
                                      : 'Auto-forward (click to require confirm)'
                                  }
                                  data-testid={`showroom-panel-chain-hitl-${edge.id}`}
                                >
                                  {edge.hitl ? '🔒' : '⚡'}
                                </button>
                              )}
                              {onRemoveChainEdge && (
                                <button
                                  type="button"
                                  onClick={() => onRemoveChainEdge(edge.id)}
                                  className="rounded p-0.5 hover:bg-indigo-100 dark:hover:bg-indigo-800/40"
                                  aria-label={`Remove forward to @${tpLabel}`}
                                  data-testid={`showroom-panel-chain-remove-${edge.id}`}
                                >
                                  <X className="size-3" aria-hidden />
                                </button>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {chainTargetCandidates.length > 0 ? (
                    <ul className="space-y-0.5">
                      {chainTargetCandidates.map((tp) => {
                        const tpLabel = panelDisplayName(tp, allPanels);
                        return (
                          <li key={tp.id}>
                            <button
                              type="button"
                              onClick={() => handleAddRoute(tp.id)}
                              className="block w-full rounded px-1.5 py-1 text-left text-[11px] hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
                              data-testid={`showroom-panel-chain-add-${panel.id}-${tp.id}`}
                            >
                              + @{tpLabel}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="text-[11px] text-zinc-500">no candidates</p>
                  )}
                  {chainAddError && (
                    <p
                      className="mt-1 text-[10px] text-rose-600 dark:text-rose-400"
                      data-testid={`showroom-panel-chain-error-${panel.id}`}
                    >
                      {chainAddError}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={onToggleMute}
            className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label={panel.state === 'live' ? 'Mute panel' : 'Unmute panel'}
            title={panel.state === 'live' ? 'Mute' : 'Unmute'}
          >
            {panel.state === 'live' ? (
              <Volume2 className="size-3.5" aria-hidden />
            ) : (
              <VolumeX className="size-3.5" aria-hidden />
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label="Close panel"
            title="Close"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto p-3 text-sm">
        {/* DM stage 3 FU (HANDOFF §3.2 · 2026-05-09) — expandable tool
            list. Toggled from the header pill above. Renders one row
            per tool with status icon + name + (when present) one-line
            input/output preview. */}
        {toolListOpen && toolCalls.length > 0 && (
          <ul
            id={`showroom-panel-tools-${panel.id}`}
            data-testid={`showroom-panel-tools-list-${panel.id}`}
            className="mb-3 rounded-md border border-zinc-200 bg-zinc-50/60 p-2 text-[11px] dark:border-zinc-700 dark:bg-zinc-800/40"
          >
            {toolCalls.map((tc) => {
              const icon =
                tc.status === 'completed'
                  ? '✅'
                  : tc.status === 'failed'
                    ? '❌'
                    : '⏳';
              // BACKLOG #5 polish — `formatToolListEntry` truncates long
              // `tc.name` (codex CLI ships full bash command as title)
              // and suppresses meta when redundant with name.
              const display = formatToolListEntry(tc);
              return (
                <li
                  key={tc.id}
                  data-testid={`showroom-panel-tool-${panel.id}-${tc.id}`}
                  className="flex items-baseline gap-2 py-0.5"
                >
                  <span aria-hidden>{icon}</span>
                  <span
                    className="truncate font-medium text-zinc-800 dark:text-zinc-200"
                    title={tc.name || '(unnamed)'}
                  >
                    {display.name}
                  </span>
                  {display.meta && (
                    <span
                      className="truncate text-zinc-500 dark:text-zinc-400"
                      title={display.meta}
                    >
                      · {display.meta}
                    </span>
                  )}
                  {(tc.status === 'pending' || tc.status === 'in_progress') && (
                    <span className="text-[10px] text-amber-600 dark:text-amber-300">
                      {tc.status === 'pending' ? 'pending' : 'running'}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {messages.length === 0 && !streaming && (
          <p className="text-xs text-zinc-500">
            {dmSessionId
              ? '대기 중 · broadcast 또는 mention 으로 시작'
              : 'DM session 준비 중…'}
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`mb-3 ${
              m.role === 'user'
                ? 'text-zinc-900 dark:text-zinc-100'
                : 'text-zinc-700 dark:text-zinc-300'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] uppercase text-zinc-500">{m.role}</span>
              {m.role === 'assistant' && onPromoteAssistant && m.text.length > 0 && (
                <button
                  type="button"
                  onClick={() => onPromoteAssistant({ messageId: m.id, text: m.text })}
                  className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-indigo-600 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-900/30"
                  aria-label="Promote answer to prior context"
                  title="Promote → next broadcast 에 context 로 첨부"
                  data-testid={`showroom-panel-promote-${panel.id}-${m.id}`}
                >
                  <Forward className="size-3" aria-hidden />
                  promote
                </button>
              )}
            </div>
            <p className="whitespace-pre-wrap">{m.text}</p>
          </div>
        ))}
        {streaming && (
          <div className="mb-3 text-zinc-700 dark:text-zinc-300">
            <span className="text-[10px] uppercase text-zinc-500">assistant…</span>
            <p className="whitespace-pre-wrap">{partial || '...'}</p>
          </div>
        )}
        {error && (
          <div className="mt-2 rounded bg-rose-50 p-2 text-xs text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
            {error}
          </div>
        )}
      </div>
      <footer
        className="border-t border-zinc-200/50 px-3 py-1.5 text-[10px] text-zinc-500 dark:border-zinc-700/50"
        data-testid={`showroom-panel-footer-${panel.id}`}
      >
        <span data-testid={`showroom-panel-dm-footer-${panel.id}`}>
          DM ·{' '}
          {dmSessionId
            ? `layout sess: ${dmSessionId.slice(0, 8)}…`
            : 'no layout session'}
        </span>
      </footer>
    </article>
  );
}
