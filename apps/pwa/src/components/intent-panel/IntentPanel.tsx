// CV-3 mobile-readiness #1 · IntentPanel grid.
//
// Two layers:
//   - <IntentPanelView />  — props-driven presenter (testable via
//     renderToStaticMarkup, mirroring HitlBannerView · β-1a split).
//   - <IntentPanel />      — container: wires NEXUS client + daemon
//     baseUrl into useIntentPrediction; also dispatches the user's
//     tapped label through an `onTap` callback the parent (Showroom
//     layout) provides for ACP forwarding.
//
// Mounted in ShowroomLayout above ShowroomInput. PWA dogfood
// (BACKLOG-pwa-mobile-readiness §2.1) → iOS Phase 1 lock widget /
// Live Activity port (PLAN-ios §4) consume the same ranking
// service.

'use client';

import { useEffect, useRef, useState } from 'react';
import { useOptionalNexusClient } from '@/nexus/hooks/use-nexus-context';
import { useDaemon } from '@/components/providers/DaemonProvider';
import { debugLog } from '@/lib/debug';
import { IntentButton } from './IntentButton';
import {
  getIntentPanelCollapsed,
  getIntentPanelDisplayMode,
  setIntentPanelCollapsed,
  subscribeIntentPanelCollapsed,
  subscribeIntentPanelDisplayMode,
  type IntentPanelDisplayMode,
} from './intent-panel-storage';
import {
  sortByConfidence,
  useIntentPrediction,
  type IntentButtonLabel,
  type IntentRanking,
} from './use-intent-prediction';

export interface IntentPanelViewProps {
  ranking: IntentRanking | null;
  submitting: boolean;
  error: string | null;
  /** Called when the user taps a button. Container forwards this
   *  to (a) the feedback POST + (b) the chat dispatcher (so
   *  '계속 진행' actually broadcasts a "계속 진행" message). */
  onTap: (label: IntentButtonLabel) => void;
  /** Collapsed state — when true, only the header chip is rendered
   *  (no 6-button grid). Persisted via intent-panel-storage. */
  collapsed?: boolean;
  /** Toggle handler — passed by the container which mutates the
   *  storage flag. Optional so renderToStaticMarkup tests can
   *  exercise the collapsed=true layout without a handler. */
  onToggleCollapsed?: () => void;
}

export function IntentPanelView({
  ranking,
  submitting,
  error,
  onTap,
  collapsed = false,
  onToggleCollapsed,
}: IntentPanelViewProps) {
  // Pre-session / pre-first-tick state — render an empty grid so
  // the layout doesn't jump when the first SSE frame arrives.
  // Using the canonical labels with 0 confidence keeps the slots
  // available for tap (the feedback POST still works; the server
  // will rank from the resulting recency).
  const candidates = ranking
    ? sortByConfidence(ranking.candidates)
    : [
        { label: '계속 진행' as IntentButtonLabel, confidence: 0, reason: 'pending' },
        { label: '오토파일럿' as IntentButtonLabel, confidence: 0, reason: 'pending' },
        { label: '추가 보완' as IntentButtonLabel, confidence: 0, reason: 'pending' },
        { label: 'diff 보여줘' as IntentButtonLabel, confidence: 0, reason: 'pending' },
        { label: '승인' as IntentButtonLabel, confidence: 0, reason: 'pending' },
        { label: '잠시 멈춤' as IntentButtonLabel, confidence: 0, reason: 'pending' },
      ];

  return (
    <div
      data-testid="intent-panel"
      data-version={ranking?.version ?? 0}
      data-collapsed={collapsed ? 'true' : 'false'}
      className="flex flex-col gap-2 border-y border-zinc-200 bg-white/70 px-3 py-2 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-900/70"
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
          intent · 다음 행동
        </span>
        <div className="flex items-center gap-2">
          {ranking && (
            <span
              className="text-[10px] text-zinc-400 dark:text-zinc-500"
              data-testid="intent-panel-version"
            >
              v{ranking.version}
            </span>
          )}
          {onToggleCollapsed && (
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label={collapsed ? 'Expand intent panel' : 'Collapse intent panel'}
              data-testid="intent-panel-toggle"
              className="rounded p-0.5 text-[11px] text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              {collapsed ? '▼' : '▲'}
            </button>
          )}
        </div>
      </div>
      {!collapsed && (
        <>
          <div
            role="group"
            aria-label="Intent suggestions"
            className="grid grid-cols-3 gap-1.5 sm:grid-cols-6"
          >
            {candidates.map((c) => (
              <IntentButton
                key={c.label}
                label={c.label}
                confidence={c.confidence}
                reason={c.reason}
                disabled={submitting || !ranking}
                onTap={() => onTap(c.label)}
              />
            ))}
          </div>
          {error && (
            <div role="alert" data-testid="intent-panel-error" className="text-[11px] text-red-600 dark:text-red-400">
              {error}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export interface IntentPanelProps {
  /** sessionId to subscribe to. Pass null when no session is
   *  active yet — the panel shows the empty grid. */
  sessionId: string | null;
  /** Forwarded to the chat dispatcher when the user taps. The
   *  Showroom layout typically broadcasts the tapped label as a
   *  user message. */
  onTap?: (label: IntentButtonLabel) => void;
}

/** Popup auto-dismiss window — once a fresh ranking lands the panel
 *  shows for this long, then hides until the next ranking version
 *  bump. Tuned for "long enough to glance + tap, short enough to
 *  not steal screen real estate". 6 seconds matches the cadence of
 *  toast notifications elsewhere in the PWA. */
const POPUP_VISIBLE_MS = 6_000;

export function IntentPanel({ sessionId, onTap }: IntentPanelProps) {
  const client = useOptionalNexusClient();
  const { config } = useDaemon();
  const { ranking, submitting, error, submitTap } = useIntentPrediction({
    client,
    sessionId,
    baseUrl: config.baseUrl,
    onDebug: (event, payload) => debugLog(event, payload),
  });

  // Persist collapsed preference in localStorage; same pattern as
  // β-1a `dmMode` (lib/showroom/runtime.ts) — start with the SSR
  // default (false) on the very first render so hydration matches,
  // then sync from storage on mount + cross-tab via storage event.
  const [collapsed, setCollapsedState] = useState(false);
  useEffect(() => {
    setCollapsedState(getIntentPanelCollapsed());
    const off = subscribeIntentPanelCollapsed(setCollapsedState);
    return off;
  }, []);
  const toggleCollapsed = (): void => {
    const next = !collapsed;
    setIntentPanelCollapsed(next);
    setCollapsedState(next);
    debugLog('intent.panel.toggle-collapsed', { collapsed: next });
  };

  // Display mode preference (2026-05-09) — fixed (always-on) vs
  // popup (briefly shown after each turn) vs off (hidden). SSR
  // default = 'fixed' to match pre-existing behavior; hydrate from
  // storage on mount + subscribe to cross-tab + same-tab updates.
  const [displayMode, setDisplayMode] = useState<IntentPanelDisplayMode>('fixed');
  useEffect(() => {
    setDisplayMode(getIntentPanelDisplayMode());
    const off = subscribeIntentPanelDisplayMode(setDisplayMode);
    return off;
  }, []);

  // Popup visibility — gated by the latest ranking version. When a
  // new ranking arrives in popup mode we show the panel for
  // POPUP_VISIBLE_MS, then auto-hide. Tap is the explicit dismiss
  // path (handled in onTap below). Effect re-runs when version
  // changes so each new ranking re-arms the timer.
  const [popupVisible, setPopupVisible] = useState(false);
  const lastVersionRef = useRef<number>(-1);
  useEffect(() => {
    if (displayMode !== 'popup') return;
    const v = ranking?.version ?? -1;
    if (v < 0 || v === lastVersionRef.current) return;
    lastVersionRef.current = v;
    setPopupVisible(true);
    const t = setTimeout(() => setPopupVisible(false), POPUP_VISIBLE_MS);
    return () => clearTimeout(t);
  }, [ranking?.version, displayMode]);

  // Mode rendering decisions:
  //   off    → render nothing (panel surface stays empty)
  //   fixed  → always render (current behavior · default)
  //   popup  → render only while popupVisible window is open
  if (displayMode === 'off') {
    return null;
  }
  if (displayMode === 'popup' && !popupVisible) {
    return null;
  }

  return (
    <IntentPanelView
      ranking={ranking}
      submitting={submitting}
      error={error}
      collapsed={collapsed}
      onToggleCollapsed={toggleCollapsed}
      onTap={(label) => {
        // Tap in popup mode also dismisses immediately — explicit
        // user signal beats the auto-fade timer.
        if (displayMode === 'popup') setPopupVisible(false);
        // Fire-and-forget feedback POST so the server's recency
        // store learns immediately. The chat dispatch happens via
        // onTap callback in parallel — both can run concurrently
        // without coupling.
        void submitTap(label);
        onTap?.(label);
      }}
    />
  );
}
