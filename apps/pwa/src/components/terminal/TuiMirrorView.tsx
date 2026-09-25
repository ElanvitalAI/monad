// ⭐P2 (capture substrate) — live TUI mirror pane. Read-only: subscribes
// to the ACP `agent_thought_chunk` stream, collects `terminalFrame`
// snapshots (the daemon's manifest→frame poller fans them out · P2-b), and
// renders the selected surface's rendered screen — the interactive
// dashboard TUI that a person is using in a SEPARATE process, mirrored
// live onto this device (picker/modal 포함).
//
// Deliberately NOT an XtermView: it must NOT `terminal/spawn` (there's no
// PWA-owned PTY for `tui:<pid>`) and takes no input — it only observes.
// Full-screen snapshot = REPLACE the screen each frame, so a monospace
// <pre> is faithful (and simpler than driving xterm). ANSI SGR is stripped
// for the mirror (monitoring, not a color-perfect terminal · matches the
// daemon's /v1/terminals observatory).
//
// cf. daemon-side `src/capture/tui-frame-broadcaster.ts` +
// PLAN-self-observation-capture-substrate §2/§5.

import { useEffect, useMemo, useState } from 'react';

import { useDaemon } from '@/components/providers/DaemonProvider';
import { debugLog } from '@/lib/debug';
import {
  applyTuiFrameEnvelope,
  emptyTuiObserveState,
  listObserveSurfaces,
  pruneStaleSurfaces,
  stripAnsi,
  type TuiObserveState,
} from '@/lib/tui-observe';

interface Props {
  sessionId: string;
}

/** How often to sweep dead surfaces (no frame within TUI_SURFACE_STALE_MS). */
const PRUNE_INTERVAL_MS = 5_000;

export function TuiMirrorView({ sessionId }: Props) {
  const { client, setSessionId } = useDaemon();
  const [state, setState] = useState<TuiObserveState>(emptyTuiObserveState);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    // Session isolation is structural: TerminalPanel keys this component by
    // sessionId, so a session change REMOUNTS with fresh state (no
    // previous-session frame can flash · review must-fix · gpt-5.6-sol).
    const acp = client.connectAcp({
      ...(sessionId ? { sessionId } : {}),
      onSession: (sid) => {
        if (sid && sid !== sessionId) setSessionId(sid);
      },
    });
    debugLog('tui-mirror.attach', { sessionId });
    // Read-only: NO terminal/spawn. Just observe the fleet's frames.
    const off = acp.on('sessionUpdate', (frame) => {
      const params = (frame.params ?? {}) as { update?: unknown };
      const u = params.update as { sessionUpdate?: string; content?: { type?: string; text?: string } } | undefined;
      if (!u || u.sessionUpdate !== 'agent_thought_chunk') return;
      const text = u.content?.type === 'text' ? u.content.text : null;
      if (!text) return;
      setState((prev) => {
        const next = applyTuiFrameEnvelope(prev, text);
        if (next !== prev) debugLog('tui-mirror.frame', { bytes: text.length });
        return next;
      });
    });
    // Sweep dead surfaces (a closed TUI stops emitting; terminalFrame has
    // no exit signal) so the Map + selector can't grow unbounded.
    const prune = setInterval(() => {
      setState((prev) => pruneStaleSurfaces(prev));
    }, PRUNE_INTERVAL_MS);
    // connectAcp() opens a fresh WebSocket per call — mirror XtermView's
    // teardown (unsubscribe THEN close) so toggling observe mode off never
    // leaks an orphaned daemon broadcast peer.
    return () => {
      clearInterval(prune);
      // Guard each teardown step independently so neither a throwing off()
      // nor close() propagates out of React's cleanup (or skips the other).
      try { off(); } catch { /* swallow — listener already gone */ }
      try { acp.close(); } catch { /* swallow — already closed */ }
    };
  }, [client, sessionId, setSessionId]);

  const surfaces = useMemo(() => listObserveSurfaces(state), [state]);

  // Auto-select the first (most-recently-active) surface once frames arrive.
  // `selected` holds the composite (instance, surfaceId) key.
  useEffect(() => {
    if (selected && state.has(selected)) return;
    setSelected(surfaces[0]?.key ?? null);
  }, [surfaces, selected, state]);

  const current = selected ? state.get(selected) : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-950 text-zinc-100">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-2 text-xs text-zinc-400">
        <span className="font-semibold text-zinc-200">🖥 TUI 관측</span>
        <span aria-live="polite">
          {surfaces.length === 0 ? '자기신고 화면 대기 중…' : `${surfaces.length}개 화면 · 라이브 미러`}
        </span>
        {surfaces.length > 0 && (
          <select
            aria-label="관측할 TUI 화면 선택"
            className="ml-auto rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-100"
            value={selected ?? ''}
            onChange={(e) => setSelected(e.target.value)}
          >
            {surfaces.map((s) => (
              <option key={s.key} value={s.key}>
                {s.surfaceId} · {s.instance}
              </option>
            ))}
          </select>
        )}
      </div>
      <pre
        // whitespace-pre (NOT pre-wrap) + horizontal scroll — a TUI is a
        // fixed col×row grid; wrapping long rows would distort the mirror
        // (review should-fix · gpt-5.6-sol).
        className="m-0 min-h-0 flex-1 overflow-auto whitespace-pre p-3 font-mono text-xs leading-snug text-zinc-100"
        aria-live="polite"
        aria-label="선택한 TUI 화면의 라이브 렌더 프레임"
      >
        {current ? stripAnsi(current.frame) : '자기신고하는 monad 화면이 아직 없습니다. 대시보드(monad)를 실행하면 여기 라이브로 미러링됩니다.'}
      </pre>
    </div>
  );
}
