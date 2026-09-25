'use client';

/** CV-3 Showroom MVP P1 — main layout component.
 *  ([RFC v4](../../../../../내부 문서 `PLAN-cv-3-showroom-mvp-2026-05-07`))
 *
 *  P1 책임:
 *  - Showroom-level state (panels[] · membership) — D10 client-side
 *  - panel-level dispatcher map (broadcast 시 invoke) — D10/D11
 *  - responsive layout (desktop horizontal · mobile vertical) — D7
 *  - text input + broadcast button — D5 broadcast first (targeted P2)
 *  - panel add/remove — D16 ephemeral close (named save P6)
 *
 *  P1 미포함: targeted dispatch (P2) · image/file attach (P3) ·
 *  terminal context (P4) · agent CLI panel (P5) · named save (P6).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, LayoutGrid, Mic, MicOff, Network, Plus, Save, Square, Trash2, Upload, Volume2, VolumeX, X } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useDaemon } from '@/components/providers/DaemonProvider';
import { newUserMessage, type ChatMessage } from '@/lib/chat-runtime';
import type { AcpConnection } from '@/lib/daemon-client';
import { useVoiceController } from '@/voice/use-voice-controller';
import { useShowroomTts } from '@/voice/use-showroom-tts';
import { useSpacebarLongPress } from '@/voice/barge-in';
import {
  deleteShowroomHybrid,
  listShowroomsHybrid,
  panelsFromSaved,
  saveShowroomHybrid,
} from '@/lib/showroom/storage';
import type { SavedShowroomLayout } from '@/lib/showroom/types';
import {
  addChainEdge,
  autoUnmuteForDispatch,
  buildMultiLlmHint,
  composeForwardText,
  createDefaultPanels,
  defaultAudioContextLabel,
  defaultClipboardContextLabel,
  defaultVideoContextLabel,
  defaultPriorAnswerLabel,
  defaultUrlContextLabel,
  extractLastAssistantText,
  findEdgesFrom,
  formatAudioContextPrefix,
  formatClipboardContextPrefix,
  formatVideoContextPrefix,
  formatPriorAnswerPrefix,
  formatTerminalContextPrefix,
  formatUrlContextPrefix,
  newAgentPanel,
  newChatPanel,
  newAudioContextId,
  newClipboardContextId,
  newVideoContextId,
  newPriorAnswerId,
  newShowroomId,
  newUrlContextId,
  panelDisplayName,
  applyToolCallEvent,
  parseMultiLlmUpdateMeta,
  parseShowroomToolCallEvent,
  planDispatch,
  planDispatchWithLlmJudge,
  readDmModeFromStorage,
  readHistoryModeFromStorage,
  readRoleJudgeBackendFromStorage,
  readRoleJudgeModelFromStorage,
  writeDmModeToStorage,
  writeHistoryModeToStorage,
  writeRoleJudgeBackendToStorage,
  type ShowroomRoleJudgeBackend,
  pruneEdgesForPanel,
  removeChainEdge,
  SHOWROOM_AGENT_BRANDS,
  wrapMultiLlmMeta,
  type AddChainEdgeFail,
  type AddChainEdgeOk,
  type AddChainEdgeOpts,
} from '@/lib/showroom/runtime';
import type {
  ChainEdge,
  ClipboardContext,
  PriorAnswer,
  ShowroomAgentBrand,
  ShowroomAudioContext,
  ShowroomPanel,
  ShowroomPanelState,
  ShowroomRoleHint,
  ShowroomVideoContext,
  TerminalContext,
  ToolCallState,
  UrlContext,
} from '@/lib/showroom/types';
import { debugLog } from '@/lib/debug';
import type { AttachmentMeta } from '@/lib/upload-attachment';
import { ShowroomPanelView } from './ShowroomPanel';
import { ShowroomInput } from './ShowroomInput';
import { HitlBanner } from './HitlBanner';
import { IntentPanel } from '../intent-panel/IntentPanel';
import { userIntentLogger } from '@/lib/user-intent-logger';
import { ShowroomHitlToggle } from './ShowroomHitlToggle';
import { ShowroomShortcutHelp } from './ShowroomShortcutHelp';
import { CostGateModal } from './CostGateModal';
import { ChainForwardGateModal } from './ChainForwardGateModal';
import { estimateBroadcastCost } from '@/lib/showroom/cost-estimator';
import { useFocusTrap } from '@/lib/use-focus-trap';
import {
  isShowroomShortcut,
  targetIsEditable,
  type EditableTargetShape,
} from '@/lib/showroom-keyboard-shortcuts';
import { useLiveAnnouncer, announcements } from '@/lib/use-live-announcer';

export function ShowroomLayout() {
  const { client, config } = useDaemon();
  const [showroomId] = useState(() => newShowroomId());
  // §6.5 — current named showroom (null = ephemeral default · string =
  // loaded named layout). Surfaces in header + tracked for URL
  // ?show=<name> query param sync.
  const [activeShowroomName, setActiveShowroomName] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const [panels, setPanels] = useState<ShowroomPanel[]>(() => createDefaultPanels());
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
  const [terminalContexts, setTerminalContexts] = useState<TerminalContext[]>([]);
  const [priorAnswers, setPriorAnswers] = useState<PriorAnswer[]>([]);
  // §3.4 (BACKLOG-showroom-cv-3-post-dm-stage-4-2026-05-09): broadcast
  // turn counter — increments on every dispatched user message. Used as
  // PriorAnswer.turnNumber so the chip can render "T{n}".
  const [turnIndex, setTurnIndex] = useState<number>(0);
  // §3.3 (C1 · 2026-05-11) — cost gate: pending broadcast paused while
  // the user reviews the token estimate. null = no gate active.
  const [pendingCostGate, setPendingCostGate] = useState<
    | { estimate: import('@/lib/showroom/cost-estimator').BroadcastCostEstimate; resume: () => Promise<void> }
    | null
  >(null);
  // §6.3 — additional context source kinds.
  const [urlContexts, setUrlContexts] = useState<UrlContext[]>([]);
  const [clipboardContexts, setClipboardContexts] = useState<ClipboardContext[]>([]);
  // R6 Task 4 · §6.3 — video / audio context sources.
  const [videoContexts, setVideoContexts] = useState<ShowroomVideoContext[]>([]);
  const [audioContexts, setAudioContexts] = useState<ShowroomAudioContext[]>([]);
  // §6.7 — chain edges (agent-to-agent direct routing).
  const [chainEdges, setChainEdges] = useState<ChainEdge[]>([]);
  // §6.7 — fired-key set ("panelId:messageId") for already-forwarded
  // finalizes. ref so the finalize watcher useEffect doesn't re-fire on
  // unrelated state updates. ephemeral · cleared on layout reset.
  const firedChainKeysRef = useRef<Set<string>>(new Set());
  // D3 (BACKLOG · 2026-05-11) — HITL gate queue. When a chain edge has
  // `hitl: true`, the finalize watcher pushes a pending forward here
  // instead of firing immediately. Modal renders one entry at a time;
  // confirm fires autoForwardToPanel, cancel skips silently.
  const [pendingChainForwards, setPendingChainForwards] = useState<
    Array<{
      key: string;          // panelId:messageId (matches firedChainKey)
      edgeId: string;
      from: { id: string; label: string };
      to: { id: string; label: string };
      forwardText: string;
      targetPanel: ShowroomPanel;
      enqueuedAt: number;
    }>
  >([]);
  const [savedLayouts, setSavedLayouts] = useState<SavedShowroomLayout[]>([]);
  const [loadMenuOpen, setLoadMenuOpen] = useState(false);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  // FP-A — save modal state (replaces window.prompt minimum).
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveDraftName, setSaveDraftName] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  // FU.B3 — keyboard shortcut help overlay state. Opened by `?` key
  // (or programmatically) · closed by Escape, X button, or backdrop click.
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  // DM stage 3 — daemon multi-LLM mode (single ACP at layout level ·
  // single session/prompt with multiLlm hint · namespaced sub-stream
  // per modelId). Default ON · localStorage-persisted opt-out only
  // (storage key `'monad.showroom.dmMode' = 'false'` opts out).
  const [dmMode, setDmModeState] = useState<boolean>(() => readDmModeFromStorage());
  // R6 FU.5 (2026-05-09) — per-user backend toggle for the role
  // classifier. Default 'keyword' (opt-in safe); 'local-llm' wires
  // the daemon's gemma-4-e4b call for ambiguous prompts.
  const [roleJudgeBackend, setRoleJudgeBackendState] =
    useState<ShowroomRoleJudgeBackend>(() => readRoleJudgeBackendFromStorage());
  // micro.3 (2026-05-09) — model override now editable via header
  // dropdown (visible when backend === 'local-llm'). Daemon's
  // /v1/llm/models proxy enumerates LM Studio's deployed list; the
  // UI shows '(daemon default)' as the first option.
  const [roleJudgeModel, setRoleJudgeModelState] =
    useState<string>(() => readRoleJudgeModelFromStorage());
  // FU.A1 (2026-05-09 night) — multi-host fan-out: each model carries
  // host + hostKind so the dropdown can <optgroup> by host name.
  const [llmModels, setLlmModels] = useState<
    readonly { id: string; ownedBy?: string; host?: string; hostKind?: string }[]
  >([]);
  const [llmModelsError, setLlmModelsError] = useState<string | null>(null);
  // FU.B2 — single live-region announcer for the whole layout. Push
  // short SR phrases on state changes that have no visible focus
  // target (judge toggle, voice phase, save/load success).
  const live = useLiveAnnouncer();
  const setRoleJudgeBackend = useCallback((next: ShowroomRoleJudgeBackend) => {
    setRoleJudgeBackendState(next);
    writeRoleJudgeBackendToStorage(next);
    live.announce(announcements.judgeToggled(next));
    debugLog('showroom.role-judge.toggle', { backend: next });
  }, [live]);
  const setRoleJudgeModel = useCallback((next: string) => {
    setRoleJudgeModelState(next);
    if (typeof window !== 'undefined') {
      try {
        if (next.length > 0) {
          window.localStorage.setItem('monad.showroom.roleJudgeModel', next);
        } else {
          window.localStorage.removeItem('monad.showroom.roleJudgeModel');
        }
      } catch { /* swallow */ }
    }
    live.announce(announcements.modelChanged(next));
    debugLog('showroom.role-judge.model', { model: next || '(default)' });
  }, [live]);
  // Lazy-load deployed model list when the toggle flips ON. Avoid
  // proactive fetch on mount so users with backend=keyword pay no
  // network cost.
  useEffect(() => {
    if (roleJudgeBackend !== 'local-llm') return;
    if (llmModels.length > 0) return; // already loaded
    let cancelled = false;
    void (async () => {
      try {
        const out = await client.listLlmModels();
        if (cancelled) return;
        setLlmModels(out.models);
        setLlmModelsError(out.error ?? null);
        debugLog('showroom.role-judge.models', {
          count: out.models.length,
          error: out.error,
        });
      } catch (e) {
        if (cancelled) return;
        setLlmModelsError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [roleJudgeBackend, llmModels.length, client]);
  // DM stage 4 (2026-05-09 night) — historyMode for multi-LLM
  // dispatch. 'isolated' (default · each panel sees own thread only)
  // vs 'mixed' (sibling lastAssistant prepended as <prior_answer>
  // blocks for cross-model deliberation automation). localStorage-
  // persisted opt-in (DM-3 chip flow stays usable regardless).
  const [historyMode, setHistoryModeState] =
    useState<'isolated' | 'mixed'>(() => readHistoryModeFromStorage());
  const [dmLayoutSessionId, setDmLayoutSessionId] = useState<string | null>(null);
  const [dmPanelStates, setDmPanelStates] = useState<
    Record<string, {
      messages: ChatMessage[];
      partial: string;
      streaming: boolean;
      error: string | null;
      /** DM stage 3 FU — agent CLI tool_call lifecycle per panel.
       *  populated by the multi-llm-bridge's tool_call /
       *  tool_call_update forward (see HANDOFF §3.2). reset on each
       *  new turn (when partial transitions back to empty). */
      toolCalls: Record<string, ToolCallState>;
    }>
  >({});
  const dmAcpRef = useRef<AcpConnection | null>(null);
  const dmLayoutSessionIdRef = useRef<string | null>(null);

  const setDmMode = useCallback((next: boolean) => {
    setDmModeState(next);
    writeDmModeToStorage(next);
    debugLog('showroom.dm.toggle', { next });
  }, []);

  // DM stage 4 — historyMode toggle (mixed ↔ isolated).
  const setHistoryMode = useCallback((next: 'isolated' | 'mixed') => {
    setHistoryModeState(next);
    writeHistoryModeToStorage(next);
    live.announce(
      next === 'mixed'
        ? 'Mixed history on · siblings’ last replies forwarded'
        : 'Mixed history off · per-panel isolated',
    );
    debugLog('showroom.dm.history-mode.toggle', { next });
  }, [live]);

  // DM stage 3 — layout-level ACP lifecycle. Listens for namespaced
  // session updates and routes each chunk back to its modelId-keyed
  // dmPanelStates entry. The legacy P1-P4 panel-local fallback was
  // removed in DM stage 3.
  //
  // §4.1 race fix (2026-05-09) — gate on `config.baseUrl` so the first
  // CSR effect pass (provider has not yet hydrated localStorage into
  // the DaemonClient) skips connectAcp() instead of throwing
  // "daemon baseUrl not configured" + retrying with a fresh
  // sessionId. Re-runs once baseUrl populates. Mirrors ChatLayout.
  useEffect(() => {
    if (!config.baseUrl) return;
    let cancelled = false;
    let acp: AcpConnection | null = null;
    try {
      acp = client.connectAcp({
        onSession: (issued) => {
          if (cancelled) return;
          dmLayoutSessionIdRef.current = issued;
          setDmLayoutSessionId(issued);
          debugLog('showroom.dm.session', { sessionId: issued });
        },
      });
    } catch (e) {
      debugLog('showroom.dm.acp.connect.error', { error: String(e) });
      return;
    }
    dmAcpRef.current = acp;
    const offUpdate = acp.on('sessionUpdate', (frame) => {
      const params = (frame.params as { update?: unknown } | undefined)?.update;
      const meta = parseMultiLlmUpdateMeta(params);
      if (!meta) return;
      const update = params as {
        sessionUpdate?: string;
        content?: { type?: string; text?: string };
      };
      // DM stage 3 FU — tool_call / tool_call_update arrive on the same
      // namespaced stream as text chunks. Route them into the panel's
      // toolCalls map without touching partial/messages, so the
      // ShowroomPanel activity pill updates live without disturbing
      // the assistant text accumulator.
      const toolEvent = parseShowroomToolCallEvent(params);
      if (toolEvent) {
        setDmPanelStates((prev) => {
          const cur = prev[meta.modelId] ?? {
            messages: [],
            partial: '',
            streaming: true,
            error: null,
            toolCalls: {} as Record<string, ToolCallState>,
          };
          return {
            ...prev,
            [meta.modelId]: {
              ...cur,
              toolCalls: applyToolCallEvent(cur.toolCalls, toolEvent, Date.now()),
            },
          };
        });
        return;
      }
      const text = update?.content?.type === 'text' ? update.content.text ?? '' : '';
      const stop = meta.stopReason;
      setDmPanelStates((prev) => {
        const cur = prev[meta.modelId] ?? {
          messages: [],
          partial: '',
          streaming: true,
          error: null,
          toolCalls: {} as Record<string, ToolCallState>,
        };
        if (stop) {
          // Finalize: append assistant message + clear streaming state.
          const finalText = (cur.partial + text).trim();
          const next = { ...prev };
          if (finalText.length > 0 || meta.error) {
            next[meta.modelId] = {
              messages: [
                ...cur.messages,
                {
                  id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  role: 'assistant',
                  text: meta.error ? `(error) ${meta.error}` : finalText,
                  timestamp: Date.now(),
                  meta: {
                    provider: meta.provider ?? '',
                    stopReason: stop,
                    ...(meta.error ? { systemLevel: 'error' as const } : {}),
                  },
                },
              ],
              partial: '',
              streaming: false,
              error: meta.error ?? null,
              toolCalls: cur.toolCalls,
            };
          } else {
            next[meta.modelId] = { ...cur, partial: '', streaming: false };
          }
          return next;
        }
        // Streaming chunk: accumulate partial.
        return {
          ...prev,
          [meta.modelId]: {
            ...cur,
            partial: cur.partial + text,
            streaming: true,
            error: null,
          },
        };
      });
    });
    return () => {
      cancelled = true;
      try { offUpdate(); } catch { /* noop */ }
      try { acp?.close(); } catch { /* noop */ }
      dmAcpRef.current = null;
      dmLayoutSessionIdRef.current = null;
    };
  }, [client, config.baseUrl]);

  // P6 + FP-B — refresh saved layouts (daemon-first · localStorage
  // fallback). Source preference logged for debugging.
  const refreshSavedLayouts = useCallback(async () => {
    const { layouts, source } = await listShowroomsHybrid(client);
    setSavedLayouts(layouts);
    debugLog('showroom.layouts.refresh', { count: layouts.length, source });
  }, [client]);
  useEffect(() => {
    void refreshSavedLayouts();
  }, [refreshSavedLayouts]);

  const handleSaveLayout = useCallback(() => {
    setSaveDraftName('');
    setSaveError(null);
    setSaveModalOpen(true);
  }, []);

  const handleSaveModalConfirm = useCallback(async () => {
    const name = saveDraftName.trim();
    if (!name) {
      setSaveError('name required');
      return;
    }
    const overwrites = savedLayouts.some((s) => s.name === name);
    const result = await saveShowroomHybrid(name, panels, client);
    debugLog('showroom.save', {
      name,
      ok: result.ok,
      panels: panels.length,
      overwrites,
      source: result.ok ? result.source : undefined,
      migrated: result.ok ? result.migrated : 0,
    });
    if (!result.ok) {
      setSaveError(result.reason);
      return;
    }
    setSaveModalOpen(false);
    setSaveDraftName('');
    setSaveError(null);
    // §6.5 — save 후 활성 showroom 으로 자동 set (URL 도 동기화).
    setActiveShowroomName(name);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('show', name);
      window.history.replaceState({}, '', url.toString());
    }
    live.announce(announcements.layoutSaved(name));
    await refreshSavedLayouts();
  }, [saveDraftName, panels, refreshSavedLayouts, savedLayouts, client, live]);

  const handleSaveModalCancel = useCallback(() => {
    setSaveModalOpen(false);
    setSaveDraftName('');
    setSaveError(null);
  }, []);

  // §3.3 (C1 · 2026-05-11) — cost gate handlers. confirm resumes the
  // pending dispatch closure; cancel discards it (state is intact —
  // attachments / priors / dispatch text stay so the user can edit).
  const handleCostGateConfirm = useCallback(async () => {
    const pending = pendingCostGate;
    if (!pending) return;
    setPendingCostGate(null);
    debugLog('showroom.cost-gate.confirm', { totalTokens: pending.estimate.totalTokens });
    try { await pending.resume(); }
    catch (err) {
      debugLog('showroom.cost-gate.resume-error', { err: err instanceof Error ? err.message : String(err) });
    }
  }, [pendingCostGate]);

  const handleCostGateCancel = useCallback(() => {
    if (!pendingCostGate) return;
    debugLog('showroom.cost-gate.cancel', { totalTokens: pendingCostGate.estimate.totalTokens });
    setPendingCostGate(null);
  }, [pendingCostGate]);

  const handleLoadLayout = useCallback((saved: SavedShowroomLayout, opts: { skipConfirm?: boolean } = {}) => {
    setLoadMenuOpen(false);
    if (!opts.skipConfirm && typeof window !== 'undefined' && panels.length > 0) {
      const ok = window.confirm(
        `Load "${saved.name}"? 현재 ${panels.length} panel state 가 교체됩니다 (저장은 별개).`,
      );
      if (!ok) return;
    }
    const restored = panelsFromSaved(saved);
    setPanels(restored);
    setAttachments([]);
    setTerminalContexts([]);
    setPriorAnswers([]);
    setUrlContexts([]);
    setClipboardContexts([]);
    setVideoContexts([]);
    setAudioContexts([]);
    // §6.7 — load resets chain edges (saved layout doesn't persist
    // edges in P6 minimum · could revisit if dogfood demands).
    setChainEdges([]);
    firedChainKeysRef.current.clear();
    // §6.5 — track active showroom + sync URL `?show=<name>` so the
    // user can share / reload the same layout. Replace state to avoid
    // history clutter on rapid switches.
    setActiveShowroomName(saved.name);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('show', saved.name);
      window.history.replaceState({}, '', url.toString());
    }
    live.announce(announcements.layoutLoaded(saved.name));
    debugLog('showroom.load', { name: saved.name, panels: restored.length });
  }, [panels, live]);

  // §6.5 — clear active showroom (return to ephemeral default · drop
  // `?show=` from URL).
  const handleClearActiveShowroom = useCallback(() => {
    setActiveShowroomName(null);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('show');
      window.history.replaceState({}, '', url.toString());
    }
    debugLog('showroom.clear-active', {});
  }, []);

  // §6.5 — on mount, if URL has `?show=<name>`, auto-load that named
  // showroom. Run once after savedLayouts list is loaded so we can
  // resolve the name → SavedShowroomLayout. autoLoadAttemptedRef
  // prevents repeated attempts when savedLayouts ref changes.
  const autoLoadAttemptedRef = useRef(false);
  useEffect(() => {
    if (autoLoadAttemptedRef.current) return;
    if (savedLayouts.length === 0 && activeShowroomName === null) {
      // Wait for savedLayouts to populate (or stay empty) before deciding.
      return;
    }
    const target = searchParams?.get('show');
    if (!target) {
      autoLoadAttemptedRef.current = true;
      return;
    }
    const saved = savedLayouts.find((s) => s.name === target);
    if (saved) {
      autoLoadAttemptedRef.current = true;
      // skipConfirm = true · auto-load on URL match shouldn't prompt.
      handleLoadLayout(saved, { skipConfirm: true });
    }
    // If not found, wait — savedLayouts may still be loading. Don't
    // mark attempted yet. After 1s timeout, give up.
  }, [savedLayouts, searchParams, activeShowroomName, handleLoadLayout]);

  useEffect(() => {
    const t = setTimeout(() => {
      autoLoadAttemptedRef.current = true;
    }, 1500);
    return () => clearTimeout(t);
  }, []);

  const handleDeleteLayout = useCallback(async (saved: SavedShowroomLayout) => {
    if (typeof window !== 'undefined') {
      const ok = window.confirm(`Delete saved layout "${saved.name}"?`);
      if (!ok) return;
    }
    const result = await deleteShowroomHybrid(saved.name, client);
    debugLog('showroom.layout.delete', {
      name: saved.name,
      ok: result.ok,
      source: result.source,
    });
    // §6.5 — 삭제된 게 active 였으면 ephemeral 로 fallback.
    if (activeShowroomName === saved.name) {
      handleClearActiveShowroom();
    }
    if (result.ok) live.announce(announcements.layoutDeleted(saved.name));
    await refreshSavedLayouts();
  }, [refreshSavedLayouts, client, activeShowroomName, handleClearActiveShowroom, live]);

  const handleAttach = useCallback((entries: AttachmentMeta[]) => {
    setAttachments((prev) => [...prev, ...entries]);
    debugLog('showroom.attach.add', {
      added: entries.length,
      filenames: entries.map((e) => e.filename),
    });
  }, []);

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
    debugLog('showroom.attach.remove', { id });
  }, []);

  const handlePinTerminalContext = useCallback((ctx: TerminalContext) => {
    setTerminalContexts((prev) => [...prev, ctx]);
    debugLog('showroom.terminal.pin', {
      id: ctx.id,
      label: ctx.label,
      bytes: ctx.text.length,
    });
  }, []);

  const handleRemoveTerminalContext = useCallback((id: string) => {
    setTerminalContexts((prev) => prev.filter((c) => c.id !== id));
    debugLog('showroom.terminal.remove', { id });
  }, []);

  // DM-3 — assistant answer promotion (RFC v4 §6.2 진짜 가치 axis)
  // §3.4 — chip 에 turnNumber 부여 (current broadcast turn) + enabled
  // multi-select toggle.
  const handlePromoteAssistant = useCallback(
    (sourcePanel: ShowroomPanel) =>
      ({ messageId, text }: { messageId: string; text: string }) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        // turnIndex is the count of broadcasts already dispatched. The
        // assistant message we promote corresponds to that turn (the
        // most recent dispatched user message). Use max(1, turnIndex)
        // so the very first promotion (before any broadcast — rare but
        // possible via panel direct chat) still renders a visible turn.
        const turnNumber = Math.max(1, turnIndex);
        const pa: PriorAnswer = {
          id: newPriorAnswerId(),
          label: defaultPriorAnswerLabel(sourcePanel, panels, Date.now(), turnNumber),
          text: trimmed,
          sourcePanelId: sourcePanel.id,
          sourceProvider: sourcePanel.provider || 'default',
          promotedAt: Date.now(),
          turnNumber,
          enabled: true,
        };
        setPriorAnswers((prev) => [...prev, pa]);
        debugLog('showroom.prior.promote', {
          panelId: sourcePanel.id,
          messageId,
          provider: sourcePanel.provider,
          bytes: trimmed.length,
          turn: turnNumber,
        });
      },
    [panels, turnIndex],
  );

  const handleRemovePriorAnswer = useCallback((id: string) => {
    setPriorAnswers((prev) => prev.filter((p) => p.id !== id));
    debugLog('showroom.prior.remove', { id });
  }, []);

  // §3.4 multi-select — chip click toggles enabled. Disabled chips
  // remain visible (count + label) but skip the broadcast prefix.
  const handleTogglePriorAnswer = useCallback((id: string) => {
    setPriorAnswers((prev) => prev.map((p) => (
      p.id === id ? { ...p, enabled: !p.enabled } : p
    )));
    debugLog('showroom.prior.toggle', { id });
  }, []);

  // §6.3 — URL context: daemon fetch + chip add.
  const handleAddUrlContext = useCallback(
    async (rawUrl: string): Promise<{ ok: boolean; reason?: string }> => {
      const trimmed = rawUrl.trim();
      if (!trimmed) return { ok: false, reason: 'url required' };
      try {
        const res = await client.fetchUrlContext(trimmed);
        const ctx: UrlContext = {
          id: newUrlContextId(),
          label: defaultUrlContextLabel(res.url, res.title),
          url: res.url,
          text: res.text,
          fetchedAt: Date.now(),
        };
        setUrlContexts((prev) => [...prev, ctx]);
        debugLog('showroom.url.add', {
          url: res.url,
          bytes: res.text.length,
          hasTitle: !!res.title,
        });
        return { ok: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        debugLog('showroom.url.error', { error: msg });
        return { ok: false, reason: msg };
      }
    },
    [client],
  );

  const handleRemoveUrlContext = useCallback((id: string) => {
    setUrlContexts((prev) => prev.filter((c) => c.id !== id));
    debugLog('showroom.url.remove', { id });
  }, []);

  // §6.3 — Clipboard context: navigator.clipboard.readText + chip.
  const handleAddClipboardContext = useCallback(async (): Promise<{ ok: boolean; reason?: string }> => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      return { ok: false, reason: 'clipboard API unavailable' };
    }
    try {
      const text = await navigator.clipboard.readText();
      if (!text || text.trim().length === 0) {
        return { ok: false, reason: 'clipboard is empty' };
      }
      const ctx: ClipboardContext = {
        id: newClipboardContextId(),
        label: defaultClipboardContextLabel(text),
        text,
        pastedAt: Date.now(),
      };
      setClipboardContexts((prev) => [...prev, ctx]);
      debugLog('showroom.clipboard.add', { bytes: text.length });
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      debugLog('showroom.clipboard.error', { error: msg });
      return { ok: false, reason: msg };
    }
  }, []);

  const handleRemoveClipboardContext = useCallback((id: string) => {
    setClipboardContexts((prev) => prev.filter((c) => c.id !== id));
    debugLog('showroom.clipboard.remove', { id });
  }, []);

  // R6 Task 4 · §6.3 — Video context: file picker → keyframe extract.
  const handleAddVideoContext = useCallback(
    async (file: File): Promise<{ ok: boolean; reason?: string }> => {
      try {
        const { extractKeyFrame } = await import('@/lib/video-frame-extract');
        const frame = await extractKeyFrame(file);
        const ctx: ShowroomVideoContext = {
          id: newVideoContextId(),
          label: defaultVideoContextLabel(frame.durationSec, frame.widthPx, frame.heightPx),
          filename: file.name,
          mimeType: frame.mimeType,
          durationSec: Math.round(frame.durationSec),
          widthPx: frame.widthPx,
          heightPx: frame.heightPx,
          frameDataUrl: frame.frameDataUrl,
          capturedAt: Date.now(),
        };
        setVideoContexts((prev) => [...prev, ctx]);
        debugLog('showroom.video.add', {
          duration: ctx.durationSec,
          dimensions: `${ctx.widthPx}x${ctx.heightPx}`,
        });
        return { ok: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        debugLog('showroom.video.error', { error: msg });
        return { ok: false, reason: msg };
      }
    },
    [],
  );

  const handleRemoveVideoContext = useCallback((id: string) => {
    setVideoContexts((prev) => prev.filter((c) => c.id !== id));
    debugLog('showroom.video.remove', { id });
  }, []);

  // R6 Task 4 · §6.3 — Audio context: file picker → metadata.
  // R6 FU.2 (2026-05-09) — fire-and-forget daemon Whisper STT in
  // parallel; chip renders immediately with metadata, transcript
  // updates when the daemon responds. Manual transcript edit remains
  // available either way (daemon rejects / user wants to edit the
  // STT output).
  const handleAddAudioContext = useCallback(
    async (file: File): Promise<{ ok: boolean; reason?: string }> => {
      try {
        const { extractAudioMeta } = await import('@/lib/audio-stt-extract');
        const meta = await extractAudioMeta(file);
        const ctx: ShowroomAudioContext = {
          id: newAudioContextId(),
          label: defaultAudioContextLabel(meta.durationSec),
          filename: file.name,
          mimeType: meta.mimeType,
          durationSec: Math.round(meta.durationSec),
          sizeBytes: meta.sizeBytes,
          transcript: '',
          loadedAt: Date.now(),
        };
        setAudioContexts((prev) => [...prev, ctx]);
        debugLog('showroom.audio.add', {
          duration: ctx.durationSec,
          size: ctx.sizeBytes,
        });
        // Daemon STT in background. The chip is already mounted so
        // the UI feels instant; the transcript fills in when ready.
        void (async () => {
          try {
            const result = await client.transcribeAudio(file);
            if (typeof result.text === 'string' && result.text.trim().length > 0) {
              setAudioContexts((prev) =>
                prev.map((c) => (c.id === ctx.id ? { ...c, transcript: result.text } : c)),
              );
              debugLog('showroom.audio.stt-ok', {
                id: ctx.id,
                chars: result.text.length,
                language: result.language,
                durationMs: result.durationMs,
              });
            }
          } catch (e) {
            debugLog('showroom.audio.stt-fail', {
              id: ctx.id,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        })();
        return { ok: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        debugLog('showroom.audio.error', { error: msg });
        return { ok: false, reason: msg };
      }
    },
    [client],
  );

  const handleRemoveAudioContext = useCallback((id: string) => {
    setAudioContexts((prev) => prev.filter((c) => c.id !== id));
    debugLog('showroom.audio.remove', { id });
  }, []);

  /** Update transcript text on an existing audio chip — wired to the
   *  ShowroomInput audio chip's edit field. */
  const handleUpdateAudioTranscript = useCallback((id: string, transcript: string) => {
    setAudioContexts((prev) =>
      prev.map((c) => (c.id === id ? { ...c, transcript } : c)),
    );
  }, []);

  // §6.7 — chain edge management. add returns the helper result so UI
  // can surface reject reason (self-route · cycle · duplicate). remove
  // is fire-and-forget.
  const handleAddChainEdge = useCallback(
    (
      fromPanelId: string,
      toPanelId: string,
      opts?: AddChainEdgeOpts,
    ): AddChainEdgeOk | AddChainEdgeFail => {
      const result = addChainEdge(chainEdges, fromPanelId, toPanelId, opts);
      if (!result.ok) {
        debugLog('showroom.chain.add.reject', {
          from: fromPanelId,
          to: toPanelId,
          reason: result.reason,
        });
        return result;
      }
      setChainEdges(result.edges);
      debugLog('showroom.chain.add', {
        from: fromPanelId,
        to: toPanelId,
        wrapMode: result.edge.wrapMode,
        edges: result.edges.length,
      });
      return result;
    },
    [chainEdges],
  );

  const handleRemoveChainEdge = useCallback((edgeId: string) => {
    setChainEdges((prev) => removeChainEdge(prev, edgeId));
    debugLog('showroom.chain.remove', { edgeId });
  }, []);

  // D3 (2026-05-11) — flip the HITL gate flag on an edge. When `hitl`
  // becomes true the finalize watcher queues a confirm modal; when it
  // becomes false the edge reverts to legacy auto-forward.
  const handleToggleChainEdgeHitl = useCallback((edgeId: string) => {
    setChainEdges((prev) =>
      prev.map((edge) => {
        if (edge.id !== edgeId) return edge;
        const next: ChainEdge = { ...edge };
        if (edge.hitl) delete next.hitl;
        else next.hitl = true;
        debugLog('showroom.chain.hitl.toggle', { edgeId, next: !edge.hitl });
        return next;
      }),
    );
  }, []);

  // §6.7 — direct dispatch to a single target panel without prefix
  // injection (terminal_context · prior_answer 의 source state 와 분리 ·
  // chain forward 는 자체 wrapping 으로 시점 결정).
  const autoForwardToPanel = useCallback(
    async (targetPanel: ShowroomPanel, forwardText: string) => {
      const layoutAcp = dmAcpRef.current;
      const layoutSessionId = dmLayoutSessionIdRef.current;
      if (!layoutAcp || !layoutSessionId) {
        debugLog('showroom.chain.forward.skip', { reason: 'no-layout-session' });
        return;
      }
      const hint = buildMultiLlmHint([targetPanel], { includeAgent: true });
      if (!hint) {
        debugLog('showroom.chain.forward.skip', { reason: 'empty-hint' });
        return;
      }
      const userMsg = newUserMessage(forwardText);
      setDmPanelStates((prev) => {
        const cur = prev[targetPanel.id] ?? {
          messages: [],
          partial: '',
          streaming: false,
          error: null,
          toolCalls: {} as Record<string, ToolCallState>,
        };
        return {
          ...prev,
          [targetPanel.id]: {
            messages: [...cur.messages, userMsg],
            partial: '',
            streaming: true,
            error: null,
            // DM stage 3 FU — fresh turn resets activity pill so prior
            // turn's tools don't bleed into the new dispatch.
            toolCalls: {},
          },
        };
      });
      try {
        await layoutAcp.send('session/prompt', {
          sessionId: layoutSessionId,
          prompt: [{ type: 'text', text: forwardText }],
          _meta: wrapMultiLlmMeta(hint),
        });
      } catch (e) {
        const errMsg = String(e);
        debugLog('showroom.chain.forward.error', { error: errMsg });
        setDmPanelStates((prev) => {
          const cur = prev[targetPanel.id];
          if (!cur) return prev;
          return {
            ...prev,
            [targetPanel.id]: { ...cur, streaming: false, error: errMsg },
          };
        });
      }
    },
    [],
  );

  // §6.7 — finalize watcher. on each `dmPanelStates` change, find
  // panels that just transitioned `streaming: true → false` with a
  // terminal assistant message, and fire any matching chain edges.
  // De-dup via firedChainKeysRef (panelId:messageId composite). target-
  // streaming guard avoids race; cycle prevention is at edge add time.
  useEffect(() => {
    if (chainEdges.length === 0) return;
    for (const [panelId, state] of Object.entries(dmPanelStates)) {
      if (state.streaming) continue;
      const lastMsg = state.messages[state.messages.length - 1];
      if (!lastMsg || lastMsg.role !== 'assistant') continue;
      if (!lastMsg.text || lastMsg.text.length === 0) continue;
      const fireKey = `${panelId}:${lastMsg.id}`;
      if (firedChainKeysRef.current.has(fireKey)) continue;
      firedChainKeysRef.current.add(fireKey);

      const sourcePanel = panels.find((p) => p.id === panelId);
      if (!sourcePanel) continue;
      const sourceLabel = panelDisplayName(sourcePanel, panels);
      const sourceProvider = sourcePanel.provider || 'default';

      const outgoing = findEdgesFrom(chainEdges, panelId).filter((e) => e.enabled);
      for (const edge of outgoing) {
        const targetPanel = panels.find((p) => p.id === edge.toPanelId);
        if (!targetPanel) continue;
        if (dmPanelStates[edge.toPanelId]?.streaming) {
          debugLog('showroom.chain.forward.skip', {
            from: panelId,
            to: edge.toPanelId,
            reason: 'target-streaming',
          });
          continue;
        }
        const forwardText = composeForwardText(
          edge,
          lastMsg.text,
          sourceProvider,
          `@${sourceLabel}`,
        );

        // D3 (2026-05-11) — HITL gate. When edge.hitl === true,
        // suspend immediate dispatch and queue a pending confirmation
        // entry; the modal renders one entry at a time and fires
        // autoForwardToPanel only on user confirm. Cancel drops the
        // entry silently (source finalize is preserved · target stays
        // idle).
        if (edge.hitl) {
          const targetLabel = panelDisplayName(targetPanel, panels);
          debugLog('showroom.chain.forward.hitl.enqueue', {
            edgeId: edge.id,
            from: panelId,
            to: edge.toPanelId,
            bytes: forwardText.length,
          });
          setPendingChainForwards((prev) => {
            // dedupe — same fireKey may be re-attempted on rapid
            // useEffect re-runs before the modal mounts.
            if (prev.some((p) => p.key === fireKey)) return prev;
            return [
              ...prev,
              {
                key: fireKey,
                edgeId: edge.id,
                from: { id: panelId, label: sourceLabel },
                to: { id: edge.toPanelId, label: targetLabel },
                forwardText,
                targetPanel,
                enqueuedAt: Date.now(),
              },
            ];
          });
          continue;
        }

        debugLog('showroom.chain.forward', {
          edgeId: edge.id,
          from: panelId,
          to: edge.toPanelId,
          wrapMode: edge.wrapMode,
          bytes: forwardText.length,
        });
        void autoForwardToPanel(targetPanel, forwardText);
      }
    }
  }, [dmPanelStates, chainEdges, panels, autoForwardToPanel]);

  // D3 (2026-05-11) — HITL gate handlers. Confirm fires the queued
  // forward, cancel drops it. Both pop the head entry off the queue.
  const handleChainForwardConfirm = useCallback(() => {
    setPendingChainForwards((prev) => {
      const head = prev[0];
      if (!head) return prev;
      debugLog('showroom.chain.forward.hitl.confirm', {
        edgeId: head.edgeId,
        from: head.from.id,
        to: head.to.id,
        bytes: head.forwardText.length,
        latencyMs: Date.now() - head.enqueuedAt,
      });
      void autoForwardToPanel(head.targetPanel, head.forwardText);
      return prev.slice(1);
    });
  }, [autoForwardToPanel]);

  const handleChainForwardCancel = useCallback(() => {
    setPendingChainForwards((prev) => {
      const head = prev[0];
      if (!head) return prev;
      debugLog('showroom.chain.forward.hitl.cancel', {
        edgeId: head.edgeId,
        from: head.from.id,
        to: head.to.id,
        bytes: head.forwardText.length,
        latencyMs: Date.now() - head.enqueuedAt,
      });
      return prev.slice(1);
    });
  }, []);

  // Phase 2 barge-in (#2068 follow-up · 2026-05-09) — wired up below
  // after the voice/tts hooks are constructed. Holding the cancel fn
  // in a ref lets handleBroadcast (defined first) reach the live
  // implementation without a hook-ordering inversion.
  const ttsCancelFnRef = useRef<(() => number) | null>(null);

  const handleBroadcast = useCallback(
    async (userText: string) => {
      const trimmed = userText.trim();
      if (!trimmed) return;
      // P4 + DM-3 + §6.3 — context prefix (frozen snapshot · url ·
      // clipboard · prior answers). ordering: terminal → url →
      // clipboard → prior_answer → user text. 모두 비어있으면 prefix 0.
      const termPrefix = formatTerminalContextPrefix(terminalContexts);
      const urlPrefix = formatUrlContextPrefix(urlContexts);
      const clipPrefix = formatClipboardContextPrefix(clipboardContexts);
      const videoPrefix = formatVideoContextPrefix(videoContexts);
      const audioPrefix = formatAudioContextPrefix(audioContexts);
      const priorPrefix = formatPriorAnswerPrefix(priorAnswers);
      // R6 Task 4 · dispatch order: terminal → url → clipboard →
      // video → audio → prior_answer → user text.
      const dispatchText = `${termPrefix}${urlPrefix}${clipPrefix}${videoPrefix}${audioPrefix}${priorPrefix}${trimmed}`;
      // P2 — broadcast vs targeted decision via planDispatch (mention
      // 은 raw user text 기준 · prefix 제외하고 분석).
      // R6 FU.5 — when the user has flipped the backend toggle to
      // 'local-llm', go through the async augment so ambiguous
      // prompts (no mention + keyword null) consult the daemon
      // judge. The keyword tier still short-circuits the common
      // case at zero cost.
      const judgeFn = roleJudgeBackend === 'local-llm'
        ? async (prompt: string) => {
            const opts: { backend: 'local-llm'; model?: string } = {
              backend: 'local-llm',
            };
            if (roleJudgeModel.length > 0) opts.model = roleJudgeModel;
            const out = await client.judgeRole(prompt, opts);
            return { role: out.role, source: out.source };
          }
        : null;
      const plan = judgeFn
        ? await planDispatchWithLlmJudge(trimmed, panels, judgeFn)
        : planDispatch(trimmed, panels);
      if (plan.targets.length === 0) return;

      // §3.3 (C1 · 2026-05-11) — pre-compute mixed mode siblings now so
      // cost-estimator sees the same prior bytes the dispatch will. The
      // canonical computation (used by buildMultiLlmHint) is repeated at
      // the daemon-call point — kept in sync to keep this surgical.
      const lastAssistantPreview = historyMode === 'mixed'
        ? Object.fromEntries(
            plan.targets
              .map((p) => [p.id, extractLastAssistantText(dmPanelStates[p.id]?.messages)] as const)
              .filter(([, v]) => typeof v === 'string' && v.length > 0),
          ) as Record<string, string>
        : undefined;
      const estimate = estimateBroadcastCost({
        dispatchText,
        dmTargets: plan.targets,
        allPanels: panels,
        ...(lastAssistantPreview ? { lastAssistantByPanelId: lastAssistantPreview } : {}),
      });

      // executeDispatch — the post-gate state mutations + daemon call.
      // Captured as a closure so CostGateModal can resume after the
      // user confirms ("Send anyway"). On gate cancel the closure is
      // discarded · all ephemeral context (attachments / priors) stays
      // intact so the user can edit + retry.
      const executeDispatch = async (): Promise<void> => {
        // §3.4 — increment broadcast turn counter so the next promotion
        // (if it happens before the assistant streams finish) carries the
        // freshly-incremented turn number on its chip.
        setTurnIndex((t) => t + 1);
        // Phase 2 barge-in — a fresh user dispatch retires the prior
        // assistant answer regardless of how many panels are still
        // speaking. No-op when nothing is in flight.
        const cancelled = ttsCancelFnRef.current?.() ?? 0;
        if (cancelled > 0) debugLog('showroom.voice.barge-in.dispatch', { cancelled });
        // P2.5 — auto-unmute (targeted mention 시 받는 panel 의 mute 해제 ·
        // freeze 는 그대로). targeted mode 만 적용.
        if (plan.mode === 'targeted') {
          const mentionedIds = plan.targets.map((t) => t.id);
          const next = autoUnmuteForDispatch(panels, mentionedIds);
          if (next.some((p, i) => p.state !== panels[i]?.state)) {
            setPanels(next);
          }
        }
        debugLog('showroom.dispatch', {
          showroomId,
          mode: plan.mode,
          routedBy: plan.routedBy,
          classifiedRole: plan.classifiedRole,
          panels: panels.length,
          targets: plan.targets.length,
          len: dispatchText.length,
          attachments: attachments.length,
          terminalContexts: terminalContexts.length,
          estTokens: estimate.totalTokens,
        });
        await runDmDispatch();
      };

      // gate fire: stash estimate + resume closure · modal hands the
      // confirm/cancel decision back to us.
      if (estimate.exceedsWarnThreshold) {
        debugLog('showroom.cost-gate.fire', {
          totalTokens: estimate.totalTokens,
          warnThreshold: estimate.warnThreshold,
          targets: plan.targets.length,
          mixed: !!lastAssistantPreview,
        });
        setPendingCostGate({ estimate, resume: executeDispatch });
        return;
      }

      await executeDispatch();
      return;
      // ─── runDmDispatch — original DM stage 3+ daemon call retained
      //     verbatim below; wrapped in a function so executeDispatch can
      //     await it. The early `return` above ensures the wrapper-style
      //     helper definition (next block) does not double-fire.
      async function runDmDispatch(): Promise<void> {
      // DM stage 3 (본 PR · 후속 #1956 → #1983) — daemon multi-LLM
      // dispatch is now the only path (single ACP · multiLlm hint ·
      // namespaced sub-stream). DM stage 1 routes chat targets to N
      // parallel `runCoreTurn` calls; DM stage 2 routes agent targets
      // to `globalDualRoleManager().clientSessionSend` (real codex/
      // claude/gemini sub-process).
      const layoutAcp = dmAcpRef.current;
      const layoutSessionId = dmLayoutSessionIdRef.current;
      if (!layoutAcp || !layoutSessionId) {
        debugLog('showroom.dm.dispatch.skip', { reason: 'no-layout-session' });
        return;
      }
      const dmTargets = plan.targets;
      // DM stage 4 — when historyMode === 'mixed', collect each panel's
      // last assistant text from dmPanelStates so the daemon can
      // prepend sibling lastAssistant blocks (`<prior_answer model=X>`).
      // 'isolated' default skips the map (legacy DM-1/2/3 wire shape).
      const lastAssistantByPanelId = historyMode === 'mixed'
        ? Object.fromEntries(
            dmTargets
              .map((p) => [p.id, extractLastAssistantText(dmPanelStates[p.id]?.messages)] as const)
              .filter(([, v]) => typeof v === 'string' && v.length > 0),
          ) as Record<string, string>
        : undefined;
      const hint = buildMultiLlmHint(dmTargets, {
        includeAgent: true,
        ...(historyMode === 'mixed' ? { historyMode: 'mixed' } : {}),
        ...(lastAssistantByPanelId ? { lastAssistantByPanelId } : {}),
      });
      if (!hint) {
        debugLog('showroom.dm.dispatch.skip', { reason: 'empty-hint' });
        return;
      }
      if (historyMode === 'mixed' && lastAssistantByPanelId) {
        debugLog('showroom.dm.dispatch.mixed', {
          siblingsWithPrior: Object.keys(lastAssistantByPanelId).length,
          totalTargets: dmTargets.length,
        });
      }
      // Attachments are dropped on the DM path — multi-LLM bridge does
      // not yet forward `userContent` to per-target prompts. Surface a
      // debug log so dogfood can spot the gap; full forwarding tracked
      // as DM stage 3 follow-up.
      if (attachments.length > 0) {
        debugLog('showroom.dm.dispatch.attachments-dropped', {
          count: attachments.length,
        });
      }
      const userMsg = newUserMessage(dispatchText);
      setDmPanelStates((prev) => {
        const next = { ...prev };
        for (const t of dmTargets) {
          const cur = next[t.id] ?? {
            messages: [],
            partial: '',
            streaming: false,
            error: null,
            toolCalls: {} as Record<string, ToolCallState>,
          };
          next[t.id] = {
            messages: [...cur.messages, userMsg],
            partial: '',
            streaming: true,
            error: null,
            // DM stage 3 FU — fresh broadcast resets the activity pill.
            toolCalls: {},
          };
        }
        return next;
      });
      try {
        await layoutAcp.send('session/prompt', {
          sessionId: layoutSessionId,
          prompt: [{ type: 'text', text: dispatchText }],
          _meta: wrapMultiLlmMeta(hint),
        });
      } catch (e) {
        debugLog('showroom.dm.dispatch.error', { error: String(e) });
        // Mark all targets as error · clear streaming state.
        const errMsg = String(e);
        setDmPanelStates((prev) => {
          const next = { ...prev };
          for (const t of dmTargets) {
            const cur = next[t.id];
            if (cur) next[t.id] = { ...cur, streaming: false, error: errMsg };
          }
          return next;
        });
      }
      // P3+P4+DM-3+§6.3 — clear ephemeral context AFTER dispatch.
      setAttachments([]);
      setTerminalContexts([]);
      setPriorAnswers([]);
      setUrlContexts([]);
      setClipboardContexts([]);
      setVideoContexts([]);
      setAudioContexts([]);
      } // ← end of runDmDispatch (C1 · §3.3)
    },
    [
      panels,
      showroomId,
      attachments,
      terminalContexts,
      priorAnswers,
      urlContexts,
      clipboardContexts,
      // FU.5 — backend toggle wires into the dispatch path; new
      // ambiguous prompts honour the latest user-flipped state.
      roleJudgeBackend,
      roleJudgeModel,
      videoContexts,
      audioContexts,
      client,
    ],
  );

  const handleStopAll = useCallback(() => {
    // DM stage 3 — Stop all is now a no-op placeholder. The legacy
    // panel-local AbortController fan-out was removed alongside the
    // panel-local ACP path. A daemon-side `session/cancel` RPC over
    // the layout's ACP is required for true stop · tracked as DM
    // stage 3 follow-up. dogfood will surface friction.
    debugLog('showroom.stop-all', { showroomId, mode: 'dm-noop' });
  }, [showroomId]);

  const handleAddPanel = useCallback(() => {
    setPanels((prev) => [...prev, newChatPanel()]);
  }, []);

  // P5 — Add Agent panel of specific brand. brand is immutable after
  // create (D6 P5 RFC) — close + new only.
  const handleAddAgent = useCallback((brand: ShowroomAgentBrand) => {
    setPanels((prev) => [...prev, newAgentPanel(brand)]);
    setAgentMenuOpen(false);
  }, []);

  const handleRemovePanel = useCallback((panelId: string) => {
    setPanels((prev) => prev.filter((p) => p.id !== panelId));
    // §6.7 — prune chain edges referencing the closed panel.
    setChainEdges((prev) => pruneEdgesForPanel(prev, panelId));
    debugLog('showroom.panel.remove', { panelId });
  }, []);

  const handlePanelState = useCallback(
    (panelId: string, state: ShowroomPanelState) => {
      setPanels((prev) =>
        prev.map((p) => (p.id === panelId ? { ...p, state } : p)),
      );
    },
    [],
  );

  const handlePanelProvider = useCallback(
    (panelId: string, provider: string) => {
      setPanels((prev) =>
        prev.map((p) => (p.id === panelId ? { ...p, provider } : p)),
      );
    },
    [],
  );

  // §6.1 — assign / clear role hint per panel.
  const handlePanelRoleHint = useCallback(
    (panelId: string, roleHint: ShowroomRoleHint | null) => {
      setPanels((prev) =>
        prev.map((p) => {
          if (p.id !== panelId) return p;
          if (roleHint === null) {
            const { roleHint: _drop, ...rest } = p;
            return rest as ShowroomPanel;
          }
          return { ...p, roleHint };
        }),
      );
      debugLog('showroom.panel.roleHint', { panelId, roleHint });
    },
    [],
  );

  // §6.4 — assign / clear persona binding. Q3 Hybrid: when persona has
  // explicit brand, panel.provider auto-coerces to that brand (UI lock
  // surfaces the lock). null → clear personaId only (provider stays).
  const handlePanelPersona = useCallback(
    (panelId: string, persona: { personaId: string; brand?: string } | null) => {
      setPanels((prev) =>
        prev.map((p) => {
          if (p.id !== panelId) return p;
          if (persona === null) {
            const { personaId: _drop, ...rest } = p;
            return rest as ShowroomPanel;
          }
          // Hybrid lock — explicit brand auto-coerces provider so the
          // dispatched LLM matches the persona's authored intent.
          const next: ShowroomPanel = { ...p, personaId: persona.personaId };
          if (persona.brand && persona.brand.length > 0) {
            next.provider = persona.brand;
          }
          return next;
        }),
      );
      debugLog('showroom.panel.persona', {
        panelId,
        personaId: persona?.personaId ?? null,
        brand: persona?.brand,
      });
    },
    [],
  );

  const liveCount = useMemo(
    () => panels.filter((p) => p.state === 'live').length,
    [panels],
  );

  // CV-3 voice integration · phase 1 (#2006 follow-up · 2026-05-08).
  // STT (mic) → final transcript → handleBroadcast (auto-send · same
  // pattern as ChatLayout's Q2=B2 wire). TTS reads each panel's just-
  // finalized assistant message via Web Speech API with a stable
  // per-panel persona voice.
  const handleBroadcastRef = useRef(handleBroadcast);
  handleBroadcastRef.current = handleBroadcast;
  const handleVoiceTranscript = useCallback((text: string): void => {
    const trimmed = text.trim();
    if (!trimmed) return;
    debugLog('showroom.voice.auto-send', { len: trimmed.length });
    void handleBroadcastRef.current(trimmed);
  }, []);
  const wsUrl = client.voiceWsUrl();
  // Phase 2 barge-in (#2068 follow-up · 2026-05-09) — refs let
  // useVoiceController.onSpeechActivity reach into the layout-level
  // TTS hook without forcing a circular hook dependency. The TTS
  // result is initialized after `voice` so we hold the ref shell now
  // and populate it below.
  const ttsRef = useRef<{ cancelInFlight: () => number; speaking: boolean } | null>(null);
  const handleBargeInActivate = useCallback((): void => {
    const t = ttsRef.current;
    if (!t || !t.speaking) return;
    const cancelled = t.cancelInFlight();
    debugLog('showroom.voice.barge-in.fire', { cancelled });
  }, []);
  const voice = useVoiceController({
    wsUrl,
    ...(config.token ? { token: config.token } : {}),
    onTranscript: handleVoiceTranscript,
    onSpeechActivity: handleBargeInActivate,
  });
  const [ttsMuted, setTtsMuted] = useState(false);
  const tts = useShowroomTts({
    panelStates: dmPanelStates,
    panels,
    enabled: voice.active && !ttsMuted,
    language: 'ko-KR',
  });
  ttsRef.current = { cancelInFlight: tts.cancelInFlight, speaking: tts.speaking };
  ttsCancelFnRef.current = tts.cancelInFlight;
  // Spacebar long-press (≥250ms) cancels in-flight TTS and force-
  // activates the mic. Only armed while TTS is actually speaking so
  // ordinary spacebar typing in chat input stays intact (the hook
  // also skips text-editable targets internally).
  useSpacebarLongPress({
    enabled: tts.speaking,
    onActivate: () => {
      const cancelled = tts.cancelInFlight();
      debugLog('showroom.voice.barge-in.spacebar', { cancelled });
      void voice.forceListen();
    },
  });

  // FU.B2 — announce voice phase transitions to the live region. Only
  // fire on actual transitions (skip the initial mount value) so SR
  // users don't hear "Voice idle" on every page load.
  const lastVoicePhaseRef = useRef<string | null>(null);
  useEffect(() => {
    const phase = voice.active ? voice.phase : 'off';
    if (lastVoicePhaseRef.current !== null && lastVoicePhaseRef.current !== phase) {
      if (phase === 'off') live.announce(announcements.voiceToggled(false));
      else live.announce(announcements.voicePhase(phase));
    }
    lastVoicePhaseRef.current = phase;
  }, [voice.active, voice.phase, live]);

  // FU.B2 — announce TTS mute state on changes. Skip initial mount so
  // SR doesn't read out the default state on every page load.
  const lastTtsMutedRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (lastTtsMutedRef.current !== null && lastTtsMutedRef.current !== ttsMuted) {
      live.announce(announcements.ttsMuted(ttsMuted));
    }
    lastTtsMutedRef.current = ttsMuted;
  }, [ttsMuted, live]);

  // FU.B1 (2026-05-09 night) — Showroom polish §1: global keyboard
  // shortcuts. ⌘K focuses the broadcast input; ⌘⇧J/M/Y toggle
  // judge / voice / TTS without leaving the keyboard. Editable
  // surfaces (input/textarea/contenteditable) suppress all but the
  // ⌘K focus-input shortcut so typing is never intercepted.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const matched = isShowroomShortcut({
        key: e.key,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        fromEditable: targetIsEditable(e.target as EditableTargetShape | null),
      });
      if (!matched) return;
      switch (matched) {
        case 'focus-broadcast-input': {
          e.preventDefault();
          const ta = document.getElementById('showroom-broadcast-input') as
            | HTMLTextAreaElement
            | null;
          if (ta) {
            ta.focus();
            // Move caret to end so Cmd+K-then-type appends.
            ta.setSelectionRange(ta.value.length, ta.value.length);
          }
          debugLog('showroom.shortcut', { id: matched, focused: !!ta });
          break;
        }
        case 'toggle-role-judge': {
          e.preventDefault();
          setRoleJudgeBackend(roleJudgeBackend === 'local-llm' ? 'keyword' : 'local-llm');
          debugLog('showroom.shortcut', { id: matched });
          break;
        }
        case 'toggle-voice': {
          e.preventDefault();
          if (!wsUrl) {
            debugLog('showroom.shortcut.suppressed', { id: matched, reason: 'no-ws-url' });
            return;
          }
          void voice.toggle();
          debugLog('showroom.shortcut', { id: matched });
          break;
        }
        case 'toggle-tts': {
          e.preventDefault();
          if (!tts.supported || !voice.active) {
            debugLog('showroom.shortcut.suppressed', { id: matched, reason: 'tts-unavailable' });
            return;
          }
          setTtsMuted((m) => !m);
          debugLog('showroom.shortcut', { id: matched });
          break;
        }
        case 'open-help': {
          e.preventDefault();
          setShortcutHelpOpen(true);
          debugLog('showroom.shortcut', { id: matched });
          break;
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    roleJudgeBackend,
    setRoleJudgeBackend,
    voice,
    wsUrl,
    tts.supported,
  ]);

  // FU.B1 — focus trap for the save modal. autoFocus on the input
  // handles initial focus, so skip the hook's auto-focus to avoid
  // stealing focus mid-render. Trap activation is gated on the modal
  // being open.
  const saveModalRef = useFocusTrap({
    active: saveModalOpen,
    skipInitialFocus: true,
  });

  return (
    <div
      className="flex h-full flex-col bg-zinc-50 dark:bg-zinc-950"
      data-testid="showroom-layout"
    >
      {/* FU.B2 — single live-region announcer for the whole layout.
          aria-live="polite" lets the SR finish the current
          utterance before announcing this · sr-only hides it
          visually. aria-atomic="true" so the SR re-reads the full
          message on each update (not just the diff). */}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-testid="showroom-live-announcer"
      >
        {live.message}
      </div>
      {/* β-1a · in-app HITL banner — fixed-position overlay above
          everything else. Renders only while a `hitl.banner.show`
          event is pending (server-side single-flight). */}
      <HitlBanner />
      <header className="flex flex-wrap items-center justify-between gap-1 border-b border-zinc-200 bg-white px-2 py-2 dark:border-zinc-800 dark:bg-zinc-900 sm:gap-2 sm:px-4">
        <div className="flex items-center gap-2">
          <LayoutGrid
            className="size-5 text-zinc-600 dark:text-zinc-300"
            aria-hidden
          />
          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Showroom
          </span>
          {activeShowroomName && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
              data-testid="showroom-active-name"
              title={`Active showroom: ${activeShowroomName}`}
            >
              <LayoutGrid className="size-3" aria-hidden />
              {activeShowroomName}
              <button
                type="button"
                onClick={handleClearActiveShowroom}
                className="rounded-full p-0.5 hover:bg-amber-100 dark:hover:bg-amber-900/50"
                aria-label="Clear active showroom (return to ephemeral)"
                data-testid="showroom-active-clear"
              >
                <X className="size-2.5" aria-hidden />
              </button>
            </span>
          )}
          <span className="text-xs text-zinc-500" data-testid="showroom-counts">
            {panels.length} panel · {liveCount} live
          </span>
          {/* Round 3 PR2 (β-2 · 2026-05-08) — vision Q1: demo without
              HITL prompts. Toggle persists in localStorage and the
              PWA agent-cli call site reads it to append ?hitl=off. */}
          <ShowroomHitlToggle />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleAddPanel}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700"
            aria-label="Add chat panel"
            title="Add chat panel"
            data-testid="showroom-add-panel"
          >
            <Plus className="size-3.5" aria-hidden />
            Chat
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setAgentMenuOpen((v) => !v)}
              className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-2 py-1 text-xs text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:bg-zinc-800 dark:text-amber-300 dark:hover:bg-amber-900/30"
              aria-label="Add agent CLI panel"
              aria-expanded={agentMenuOpen}
              title="Add agent CLI panel (codex · claude · gemini)"
              data-testid="showroom-add-agent-toggle"
            >
              <Bot className="size-3.5" aria-hidden />
              Agent
            </button>
            {agentMenuOpen && (
              <div
                className="absolute right-0 top-full z-10 mt-1 w-44 rounded-md border border-zinc-300 bg-white text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
                data-testid="showroom-agent-menu"
              >
                {SHOWROOM_AGENT_BRANDS.map((brand) => (
                  <button
                    key={brand}
                    type="button"
                    onClick={() => handleAddAgent(brand)}
                    className="block w-full border-b border-zinc-200/50 px-2 py-1.5 text-left hover:bg-zinc-50 last:border-b-0 dark:border-zinc-700/50 dark:hover:bg-zinc-700"
                    data-testid={`showroom-add-agent-${brand}`}
                  >
                    <span className="font-medium">{brand}-cli</span>
                    <span className="ml-1 text-[10px] text-zinc-500">CLI agent</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={handleSaveLayout}
            disabled={panels.length === 0}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700"
            aria-label="Save layout"
            title="Save current panel layout"
            data-testid="showroom-save-layout"
          >
            <Save className="size-3.5" aria-hidden />
            Save
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setLoadMenuOpen((v) => !v)}
              disabled={savedLayouts.length === 0}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700"
              aria-label="Load saved layout"
              title={
                savedLayouts.length === 0
                  ? '저장된 layout 없음'
                  : `${savedLayouts.length} saved layout`
              }
              aria-expanded={loadMenuOpen}
              data-testid="showroom-load-toggle"
            >
              <Upload className="size-3.5" aria-hidden />
              Load
              {savedLayouts.length > 0 && (
                <span className="ml-1 text-[10px] text-zinc-500">
                  {savedLayouts.length}
                </span>
              )}
            </button>
            {loadMenuOpen && savedLayouts.length > 0 && (
              <div
                className="absolute right-0 top-full z-10 mt-1 max-h-64 w-64 overflow-y-auto rounded-md border border-zinc-300 bg-white text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
                data-testid="showroom-load-menu"
              >
                {savedLayouts.map((s) => (
                  <div
                    key={s.name}
                    className="flex items-center justify-between gap-2 border-b border-zinc-200/50 px-2 py-1 last:border-b-0 dark:border-zinc-700/50"
                  >
                    <button
                      type="button"
                      onClick={() => handleLoadLayout(s)}
                      className="flex flex-1 flex-col text-left hover:text-zinc-900 dark:hover:text-zinc-100"
                      data-testid={`showroom-load-${s.name}`}
                    >
                      <span className="font-medium">{s.name}</span>
                      <span className="text-[10px] text-zinc-500">
                        {s.panels.length} panel · {new Date(s.savedAt).toLocaleString()}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteLayout(s)}
                      className="rounded p-1 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30"
                      aria-label={`Delete layout ${s.name}`}
                      data-testid={`showroom-delete-${s.name}`}
                    >
                      <Trash2 className="size-3" aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setDmMode(!dmMode)}
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${
              dmMode
                ? 'border-indigo-400 bg-indigo-50 text-indigo-700 dark:border-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300'
                : 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
            }`}
            aria-label="Toggle daemon multi-LLM dispatch preference (DM stage 3 · always engaged)"
            aria-pressed={dmMode}
            title={
              dmMode
                ? 'DM stage 3 · always engaged · single ACP · multiLlm hint · namespaced sub-stream'
                : 'DM preference OFF · panel-local fallback was removed in DM stage 3 · DM dispatch still active'
            }
            data-testid="showroom-dm-toggle"
          >
            <Network className="size-3.5" aria-hidden />
            DM
            {dmMode && (
              <span
                className="ml-0.5 rounded bg-indigo-600 px-1 text-[9px] uppercase text-white"
                data-testid="showroom-dm-toggle-on"
              >
                on
              </span>
            )}
          </button>
          {/* DM stage 4 — historyMode toggle pill (mixed ↔ isolated).
              Mixed forwards each panel's last assistant text as
              <prior_answer model=X> blocks to siblings, automating
              cross-model deliberation. localStorage-persisted opt-in
              (token cost intentional). */}
          <button
            type="button"
            onClick={() => setHistoryMode(historyMode === 'mixed' ? 'isolated' : 'mixed')}
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${
              historyMode === 'mixed'
                ? 'border-fuchsia-400 bg-fuchsia-50 text-fuchsia-700 dark:border-fuchsia-600 dark:bg-fuchsia-900/30 dark:text-fuchsia-300'
                : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
            }`}
            aria-label="Toggle DM stage 4 mixed history mode"
            aria-pressed={historyMode === 'mixed'}
            title={
              historyMode === 'mixed'
                ? 'Mixed history ON · siblings’ last replies auto-prepended as <prior_answer> blocks (cross-model deliberation automation · token cost increases)'
                : 'Mixed history OFF · each panel sees only its own thread (default · token-frugal)'
            }
            data-testid="showroom-history-mode-toggle"
          >
            <Network className="size-3.5" aria-hidden />
            mix
            {historyMode === 'mixed' && (
              <span
                className="ml-0.5 rounded bg-fuchsia-600 px-1 text-[9px] uppercase text-white"
                data-testid="showroom-history-mode-toggle-on"
              >
                on
              </span>
            )}
          </button>
          {/* R6 FU.5 — role-judge backend toggle (keyword vs local-llm).
              Default keyword (opt-in safe). Click toggles state +
              persists to localStorage; ambiguous prompts honour the
              flip on the next dispatch. */}
          <button
            type="button"
            onClick={() => setRoleJudgeBackend(roleJudgeBackend === 'local-llm' ? 'keyword' : 'local-llm')}
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${
              roleJudgeBackend === 'local-llm'
                ? 'border-violet-400 bg-violet-50 text-violet-700 dark:border-violet-600 dark:bg-violet-900/30 dark:text-violet-300'
                : 'border-zinc-300 bg-white text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400'
            }`}
            aria-label="Toggle role-judge backend (keyword vs local-llm)"
            aria-pressed={roleJudgeBackend === 'local-llm'}
            title={
              roleJudgeBackend === 'local-llm'
                ? `Local LLM judge · ambiguous prompts call daemon → LM Studio (model: ${roleJudgeModel || 'default'}). Click to switch to keyword-only.`
                : 'Keyword-only · ambiguous prompts broadcast (default). Click to engage local LLM.'
            }
            data-testid="showroom-role-judge-toggle"
          >
            <Bot className="size-3.5" aria-hidden />
            judge
            {roleJudgeBackend === 'local-llm' && (
              <span
                className="ml-0.5 rounded bg-violet-600 px-1 text-[9px] uppercase text-white"
                data-testid="showroom-role-judge-toggle-on"
              >
                LLM
              </span>
            )}
          </button>
          {/* micro.3 — model select dropdown. visible only when toggle
              is ON. '(daemon default)' = empty string · honour daemon's
              MONAD_SHOWROOM_ROLE_JUDGE_MODEL env / hardcoded default. */}
          {roleJudgeBackend === 'local-llm' && (
            <select
              value={roleJudgeModel}
              onChange={(e) => setRoleJudgeModel(e.target.value)}
              className="rounded-md border border-violet-300 bg-white px-2 py-1 text-xs text-violet-700 dark:border-violet-700 dark:bg-zinc-800 dark:text-violet-300"
              aria-label="Select LLM judge model"
              title={
                llmModelsError
                  ? `Model list unavailable: ${llmModelsError}. Type the model id directly via DevTools localStorage.`
                  : `Pick a deployed model · ${llmModels.length} loaded · empty = daemon default (mlx-community/gemma-4-26b-a4b-it)`
              }
              data-testid="showroom-role-judge-model-select"
            >
              <option value="">(daemon default)</option>
              {(() => {
                // FU.A1 — group by host so the dropdown surfaces which
                // backend each model lives on. Single-host configs
                // collapse to a flat list (no <optgroup> wrapper) so
                // the legacy LM Studio-only dogfood UX is unchanged.
                const chatModels = llmModels.filter((m) => !/embed/i.test(m.id));
                const groups = new Map<string, typeof chatModels>();
                for (const m of chatModels) {
                  const key = m.host ?? '';
                  const arr = groups.get(key) ?? [];
                  arr.push(m);
                  groups.set(key, arr);
                }
                if (groups.size <= 1) {
                  return chatModels.map((m) => (
                    <option key={`${m.host ?? 'h'}::${m.id}`} value={m.id}>
                      {m.id}
                    </option>
                  ));
                }
                return Array.from(groups.entries()).map(([host, models]) => (
                  <optgroup key={host || 'unknown'} label={host || '(unknown host)'}>
                    {models.map((m) => (
                      <option key={`${host}::${m.id}`} value={m.id}>
                        {m.id}
                      </option>
                    ))}
                  </optgroup>
                ));
              })()}
            </select>
          )}
          {/* CV-3 voice phase 1 — mic toggle (STT) + TTS mute. The mic
              feeds final transcripts into handleBroadcast (auto-send).
              The TTS toggle is co-located so listeners can silence
              speech without dropping mic capture. */}
          <button
            type="button"
            onClick={() => { void voice.toggle(); }}
            disabled={!wsUrl}
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${
              voice.active
                ? 'border-emerald-400 bg-emerald-50 text-emerald-700 dark:border-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300'
                : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
            } disabled:cursor-not-allowed disabled:opacity-50`}
            aria-label={voice.active ? 'Stop voice mode' : 'Start voice mode'}
            aria-pressed={voice.active}
            title={
              !wsUrl
                ? 'Voice WebSocket URL is unavailable — daemon `/voice/ws` not configured'
                : voice.active
                  ? `Voice ${voice.phase} · click to stop`
                  : 'Voice mode OFF · click to start mic + STT'
            }
            data-testid="showroom-voice-toggle"
          >
            {voice.active ? <Mic className="size-3.5" aria-hidden /> : <MicOff className="size-3.5" aria-hidden />}
            {voice.active && (
              <span
                className="ml-0.5 rounded bg-emerald-600 px-1 text-[9px] uppercase text-white"
                data-testid="showroom-voice-toggle-on"
              >
                {voice.phase === 'listening' ? 'listen' : voice.phase}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setTtsMuted((m) => !m)}
            disabled={!tts.supported || !voice.active}
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${
              ttsMuted
                ? 'border-zinc-300 bg-zinc-50 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400'
                : 'border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-700 dark:bg-sky-900/30 dark:text-sky-300'
            } disabled:cursor-not-allowed disabled:opacity-50`}
            aria-label={ttsMuted ? 'Unmute panel TTS' : 'Mute panel TTS'}
            aria-pressed={ttsMuted}
            title={
              !tts.supported
                ? 'Web Speech API is unavailable in this browser'
                : !voice.active
                  ? 'Start voice mode to enable per-panel TTS'
                  : ttsMuted
                    ? 'Panel TTS muted · click to unmute'
                    : 'Panel TTS active · click to mute'
            }
            data-testid="showroom-tts-toggle"
          >
            {ttsMuted ? <VolumeX className="size-3.5" aria-hidden /> : <Volume2 className="size-3.5" aria-hidden />}
            TTS
          </button>
          <button
            type="button"
            onClick={handleStopAll}
            className="inline-flex items-center gap-1 rounded-md border border-rose-300 bg-white px-2 py-1 text-xs text-rose-700 hover:bg-rose-50 dark:border-rose-700 dark:bg-zinc-800 dark:text-rose-300 dark:hover:bg-rose-900/30"
            aria-label="Stop all panels"
            title="Stop all (placeholder · P2 wire)"
          >
            <Square className="size-3.5" aria-hidden />
            Stop all
          </button>
        </div>
      </header>
      <div
        className={`flex flex-1 flex-col gap-2 overflow-hidden p-2 ${
          // ROADMAP-ipad-companion-cascade B-2 (2026-05-16) — bumped from
          // `lg:flex-row` (1024px+) to `xl:flex-row` (1280px+) so iPad
          // landscape (1024-1279pt) renders the panel grid as a vertical
          // stack. Desktop browsers under 1280 keep the same vertical
          // layout; emergency override via `?layout=horizontal` for the
          // rare desktop user who wants the prior side-by-side density.
          searchParams?.get('layout') === 'horizontal' ? 'flex-row' : 'xl:flex-row'
        }`}
        data-testid="showroom-grid"
      >
        {panels.length === 0 && (
          <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
            모든 panel 이 닫혔습니다 · 위의 + Panel 으로 추가
          </div>
        )}
        {panels.map((panel) => (
          <ShowroomPanelView
            key={panel.id}
            panel={panel}
            allPanels={panels}
            client={client}
            onClose={() => handleRemovePanel(panel.id)}
            onState={(state) => handlePanelState(panel.id, state)}
            onProvider={(p) => handlePanelProvider(panel.id, p)}
            onPromoteAssistant={handlePromoteAssistant(panel)}
            outgoingEdges={findEdgesFrom(chainEdges, panel.id)}
            onAddChainEdge={handleAddChainEdge}
            onRemoveChainEdge={handleRemoveChainEdge}
            onToggleChainEdgeHitl={handleToggleChainEdgeHitl}
            onRoleHint={(role) => handlePanelRoleHint(panel.id, role)}
            onPersona={(persona) => handlePanelPersona(panel.id, persona)}
            dmState={dmPanelStates[panel.id]}
            dmSessionId={dmLayoutSessionId}
          />
        ))}
      </div>
      {/* FU.B3 — keyboard shortcut help overlay. Opened by `?` key
          (see useEffect with isShowroomShortcut) · closed by Escape,
          X button, or backdrop click. */}
      <ShowroomShortcutHelp
        open={shortcutHelpOpen}
        onClose={() => setShortcutHelpOpen(false)}
      />
      {/* §3.3 (C1 · 2026-05-11) — cost gate modal. Fires when the
          estimated broadcast cost crosses the warn threshold (default
          50_000 tokens · NEXT_PUBLIC_MONAD_SHOWROOM_BROADCAST_COST_WARN_TOKENS
          override). pendingCostGate holds the resume closure so confirm
          replays the exact dispatch · cancel discards. */}
      {pendingCostGate && (
        <CostGateModal
          estimate={pendingCostGate.estimate}
          onConfirm={handleCostGateConfirm}
          onCancel={handleCostGateCancel}
        />
      )}
      {/* D3 (2026-05-11) — §6.7 HITL gate. Renders one queue head at
          a time; confirm fires the deferred autoForwardToPanel, cancel
          drops the entry silently. */}
      <ChainForwardGateModal
        pending={
          pendingChainForwards[0]
            ? {
                from: pendingChainForwards[0].from,
                to: pendingChainForwards[0].to,
                forwardText: pendingChainForwards[0].forwardText,
              }
            : undefined
        }
        queueLength={pendingChainForwards.length}
        onConfirm={handleChainForwardConfirm}
        onCancel={handleChainForwardCancel}
      />

      {saveModalOpen && (
        <div
          ref={saveModalRef}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="showroom-save-modal-title"
          data-testid="showroom-save-modal"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              handleSaveModalCancel();
            }
          }}
        >
          <div className="w-full max-w-md rounded-lg border border-zinc-300 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
            <h2
              id="showroom-save-modal-title"
              className="mb-2 text-sm font-medium text-zinc-900 dark:text-zinc-100"
            >
              Save Showroom layout
            </h2>
            <p className="mb-3 text-xs text-zinc-500">
              {panels.length} panel · sessionId 는 fresh handshake 으로 load 시 재발급
            </p>
            <input
              type="text"
              value={saveDraftName}
              onChange={(e) => {
                setSaveDraftName(e.target.value);
                setSaveError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSaveModalConfirm();
                }
              }}
              placeholder="layout name (e.g., morning · debug-X · pair-A)"
              className="mb-2 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:border-zinc-700 dark:bg-zinc-800"
              data-testid="showroom-save-modal-input"
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
            {saveDraftName.trim()
              && savedLayouts.some((s) => s.name === saveDraftName.trim()) && (
              <p
                className="mb-2 text-[11px] text-amber-700 dark:text-amber-300"
                data-testid="showroom-save-modal-overwrite-warn"
              >
                같은 이름의 layout 이 이미 있어요 · save 시 overwrite
              </p>
            )}
            {saveError && (
              <p
                className="mb-2 text-[11px] text-rose-700 dark:text-rose-300"
                data-testid="showroom-save-modal-error"
              >
                {saveError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={handleSaveModalCancel}
                className="rounded-md border border-zinc-300 bg-white px-3 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700"
                data-testid="showroom-save-modal-cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveModalConfirm}
                disabled={!saveDraftName.trim()}
                className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="showroom-save-modal-confirm"
              >
                <Save className="size-3" aria-hidden />
                Save
              </button>
            </div>
          </div>
        </div>
      )}
      {/* PWA mobile-readiness #1 (2026-05-08) — IntentPanel above
          the input bar. Subscribes to the layout-level DM session
          (default ON since β-1a #2006); pass null when DM is off
          so the panel renders the empty grid without ticking the
          backend. Tapping a label both POSTs feedback (recency
          boost) and broadcasts the label text as a user message
          via handleBroadcast. */}
      <IntentPanel
        sessionId={dmLayoutSessionId}
        onTap={(label) => {
          // β (BACKLOG-pwa-mobile-readiness §6.1 #1 metric · 2026-05-12) — emit
          // intent button tap before broadcasting. Patcher / Thinker / dashboard
          // 위 selection signal · `userIntentLogger.emit` 의 fan-out (signal-bus +
          // JSONL + OTel) 으로 hit-rate metric 자동 누적.
          void userIntentLogger.emit({
            surface: 'pwa',
            intent: {
              layer: 'selection',
              kind: 'pwa.selection.intent_button_tap',
              target: { kind: 'intent_button', id: label, label },
            },
            ...(dmLayoutSessionId
              ? { context: { active_showroom_session_id: dmLayoutSessionId } }
              : {}),
          });
          void handleBroadcast(label);
        }}
      />
      <ShowroomInput
        onSend={handleBroadcast}
        panels={panels}
        liveCount={liveCount}
        attachments={attachments}
        onAttach={handleAttach}
        onRemoveAttachment={handleRemoveAttachment}
        terminalContexts={terminalContexts}
        onPinTerminalContext={handlePinTerminalContext}
        onRemoveTerminalContext={handleRemoveTerminalContext}
        priorAnswers={priorAnswers}
        onRemovePriorAnswer={handleRemovePriorAnswer}
        onTogglePriorAnswer={handleTogglePriorAnswer}
        urlContexts={urlContexts}
        onAddUrlContext={handleAddUrlContext}
        onRemoveUrlContext={handleRemoveUrlContext}
        clipboardContexts={clipboardContexts}
        onAddClipboardContext={handleAddClipboardContext}
        onRemoveClipboardContext={handleRemoveClipboardContext}
        videoContexts={videoContexts}
        onAddVideoContext={handleAddVideoContext}
        onRemoveVideoContext={handleRemoveVideoContext}
        audioContexts={audioContexts}
        onAddAudioContext={handleAddAudioContext}
        onRemoveAudioContext={handleRemoveAudioContext}
        onUpdateAudioTranscript={handleUpdateAudioTranscript}
        listTerminals={() => client.listTerminals()}
        fetchTerminalScrollback={(id, lines) => client.fetchTerminalScrollback(id, lines)}
      />
    </div>
  );
}
