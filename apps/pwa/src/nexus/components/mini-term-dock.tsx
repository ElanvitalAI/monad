// PWA · MiniTermDock (Phase N-4 PR ρ)
//
// Subscribes to /v1/nexus/tabs/:id/logs?stream=1 SSE · auto-scrolls
// (unless user scrolled up) · pause toggle · clear button · stdout
// vs stderr color tone. Drops into TabDetail bottom edge or a global
// dock at the AppShell bottom.

'use client';

import { useEffect, useRef } from 'react';
import { useTabLogsStream } from '../hooks/use-tab-logs-stream';
import { LogLine } from './log-line';

export interface MiniTermDockProps {
  tabId: string;
  /** Max in-memory lines · default 1000. */
  maxLines?: number;
  /** Initial collapsed state · default false. */
  initialCollapsed?: boolean;
  /** Custom title shown in the header (default = tabId). */
  title?: string;
}

export function MiniTermDock({ tabId, maxLines, initialCollapsed, title }: MiniTermDockProps) {
  const { lines, paused, setPaused, clear, connected } = useTabLogsStream(tabId, maxLines !== undefined ? { maxLines } : {});
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true); // auto-scroll if true
  const collapseRef = useRef(initialCollapsed ?? false);

  // Auto-scroll whenever new lines arrive, unless the user scrolled up.
  useEffect(() => {
    if (!stickRef.current || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lines]);

  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 16;
    stickRef.current = atBottom;
  }

  return (
    <div className="flex flex-col bg-zinc-950 border-t border-zinc-800 text-zinc-100 max-h-72">
      <header className="flex items-center gap-2 px-3 py-1.5 text-xs border-b border-zinc-800 bg-zinc-900">
        <span className="font-mono text-zinc-400">{title ?? tabId}</span>
        <span className={`text-xs ${connected ? 'text-emerald-400' : 'text-zinc-500'}`}>
          {connected ? '● live' : '○ disconnected'}
        </span>
        <span className="text-zinc-600 ml-auto">{lines.length} lines</span>
        <button
          type="button"
          onClick={() => setPaused(!paused)}
          className={`px-2 py-0.5 rounded text-xs border border-zinc-700 hover:bg-zinc-800 ${paused ? 'text-amber-300' : 'text-zinc-300'}`}
        >
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button
          type="button"
          onClick={clear}
          className="px-2 py-0.5 rounded text-xs border border-zinc-700 hover:bg-zinc-800 text-zinc-300"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={() => { collapseRef.current = !collapseRef.current; }}
          className="px-2 py-0.5 rounded text-xs border border-zinc-700 hover:bg-zinc-800 text-zinc-300"
        >
          {collapseRef.current ? 'Expand' : 'Collapse'}
        </button>
      </header>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="overflow-y-auto flex-1 px-3 py-2"
      >
        {lines.length === 0
          ? <div className="text-zinc-600 text-xs italic">no log output yet</div>
          : lines.map((entry) => <LogLine key={entry.seq} entry={entry} />)}
      </div>
    </div>
  );
}
