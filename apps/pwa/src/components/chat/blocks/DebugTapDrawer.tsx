// M6 PR 2 (PLAN-rich-dev-feedback-multi-surface · 2026-05-13) — debug-tap
// off-canvas drawer.
//
// Lives at chat-shell level (mounted by `ChatLayout` next to the message
// stream) so the live debug tail isn't tied to a single assistant
// message. ChatLayout flattens the `debug_session` blocks across all
// assistant messages (every turn's bridge instance ships its own
// session-level block) into a single ordered list before passing it
// here — the drawer is a pure render surface plus a regex filter.

'use client';

import { useMemo, useState } from 'react';

import { cn } from '@/lib/utils';

/** Wire-mirror of `debug_session` block line entries. Kept local so the
 *  drawer can be reused with synthetic line lists (e.g. tests, future
 *  daemon-wide debug overlay). */
export interface DebugTapLine {
  /** Stable React key — envelope seq from the per-turn debug-bridge.
   *  Combined with `turnIndex` upstream when multiple turns flatten. */
  seq: number;
  category: string;
  event: string;
  data?: unknown;
  /** ms epoch (daemon clock). */
  loggedAt: number;
}

export interface DebugTapDrawerProps {
  /** Renders the drawer when true; collapses (translateY) when false so
   *  the close transition can finish before unmount. Caller decides
   *  whether to also drop the component from the tree on close. */
  open: boolean;
  onClose: () => void;
  lines: readonly DebugTapLine[];
}

/** UI-side ring cap. The drawer can render more if the caller already
 *  flattened many turns — but we never visualize more than this many
 *  rows at once to keep the DOM bounded. Matches the daemon-side bridge
 *  cap so the worst-case render set has parity. */
const DRAWER_RENDER_CAP = 200;

export function DebugTapDrawer({
  open,
  onClose,
  lines,
}: DebugTapDrawerProps) {
  const [filterText, setFilterText] = useState('');
  const regex = useMemo<RegExp | null>(() => {
    if (!filterText.trim()) return null;
    try {
      return new RegExp(filterText, 'i');
    } catch {
      // Invalid regex (mid-typing) — treat as plain substring fallback
      // so the filter box stays responsive without throwing on every
      // keystroke.
      return null;
    }
  }, [filterText]);
  const fallbackText = useMemo(() => filterText.trim().toLowerCase(), [filterText]);
  const filtered = useMemo(() => {
    const source = lines.length > DRAWER_RENDER_CAP
      ? lines.slice(lines.length - DRAWER_RENDER_CAP)
      : lines;
    if (regex) {
      return source.filter(
        (l) => regex.test(l.category) || regex.test(l.event),
      );
    }
    if (fallbackText) {
      return source.filter(
        (l) =>
          l.category.toLowerCase().includes(fallbackText)
          || l.event.toLowerCase().includes(fallbackText),
      );
    }
    return source;
  }, [lines, regex, fallbackText]);

  return (
    <div
      data-monad-debug-tap-drawer={open ? 'open' : 'closed'}
      className={cn(
        'fixed bottom-0 left-0 right-0 z-50 transition-transform duration-200 ease-out',
        'pointer-events-none',
        open ? 'translate-y-0' : 'translate-y-full',
      )}
      role="region"
      aria-label="Debug Tap Drawer"
      aria-hidden={!open}
    >
      <div
        className={cn(
          'pointer-events-auto mx-auto flex max-h-[60vh] w-full max-w-[1100px] flex-col',
          'rounded-t-md border border-b-0 border-border bg-card shadow-xl',
        )}
      >
        <header className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Debug Tap
            </span>
            <span
              className="text-[10px] text-muted-foreground/70"
              data-monad-debug-tap-count={filtered.length}
              data-monad-debug-tap-total={lines.length}
            >
              {filtered.length}/{lines.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="regex filter…"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              className={cn(
                'w-40 rounded border border-border bg-background px-2 py-1 text-[11px] font-mono',
                'focus:outline-none focus:ring-1 focus:ring-primary',
              )}
              data-monad-debug-tap-filter=""
              aria-label="Filter debug lines"
            />
            <button
              type="button"
              onClick={onClose}
              className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Close debug drawer"
              data-monad-debug-tap-close=""
            >
              ✕
            </button>
          </div>
        </header>
        <ul
          className="flex-1 overflow-y-auto px-3 py-2 text-[11px] font-mono"
          data-monad-debug-tap-list=""
        >
          {filtered.length === 0 ? (
            <li className="italic text-muted-foreground/60">
              {lines.length === 0 ? '(no debug lines yet)' : '(no matches for filter)'}
            </li>
          ) : (
            filtered.map((line, idx) => (
              <DebugTapRow key={`${line.loggedAt}-${line.seq}-${idx}`} line={line} />
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

function DebugTapRow({ line }: { line: DebugTapLine }) {
  const time = new Date(line.loggedAt).toISOString().slice(11, 23);
  return (
    <li
      data-monad-debug-tap-line=""
      data-monad-category={line.category}
      data-monad-event={line.event}
      className="py-0.5"
    >
      <span className="text-muted-foreground/70">[{time}]</span>{' '}
      <span className="text-amber-400">[{line.category}]</span>{' '}
      <span className="text-foreground">{line.event}</span>
      {line.data !== undefined && (
        <details className="ml-4 text-muted-foreground">
          <summary className="cursor-pointer select-none text-[10px]">data</summary>
          <pre className="m-0 mt-1 whitespace-pre-wrap break-all text-[10px] text-muted-foreground/80">
            {safeStringify(line.data)}
          </pre>
        </details>
      )}
    </li>
  );
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
