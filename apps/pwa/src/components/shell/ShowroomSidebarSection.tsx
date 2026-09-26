'use client';

/** R6 Task 2 · §6.5 sidebar widget (2026-05-09).
 *
 *  Quick-switch list of saved Showroom layouts in the left sidebar.
 *  Existing flow (load dropdown inside the showroom header) costs the
 *  user a 2-step interaction every switch; for daily multi-room use a
 *  permanent rail makes the round-trip closer to a tab switch.
 *
 *  Behaviour (HANDOFF §3.4):
 *    - 1-click switch → router.push(`/showroom?show=<name>`); the
 *      showroom layout's existing `?show=` watcher does the load.
 *    - active highlight matches the URL search param
 *    - daemon-first list with localStorage fallback (offline / SSR)
 *    - empty state — "Save a layout to populate this list"
 *    - silently no-op when not wrapped in DaemonProvider (we read the
 *      context directly to avoid the `useDaemon` throw — sidebar is
 *      mounted on routes that may or may not initialise the provider).
 *    - compact rail mode is not supported (list is text-heavy); the
 *      caller hides the section in compact mode.
 */

import { useCallback, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { LayoutGrid } from 'lucide-react';
import { DaemonContext } from '@/components/providers/DaemonProvider';
import { listShowroomsHybrid } from '@/lib/showroom/storage';
import type { SavedShowroomLayout } from '@/lib/showroom/types';
import { cn } from '@/lib/utils';
import { debugLog } from '@/lib/debug';
import { subscribeSharedEventSource } from '@/lib/shared-event-source';

/** Pure helper — picks the active layout name out of a router context.
 *  Active when the user is currently viewing `/showroom` AND the
 *  `?show=<name>` query matches one of the saved layouts. Exported
 *  for unit tests so we don't have to mount the Next router. */
export function isLayoutActive(
  layoutName: string,
  pathname: string | null,
  showQuery: string | null,
): boolean {
  if (!pathname) return false;
  const normalized = pathname.replace(/\/+$/, '');
  if (normalized !== '/showroom') return false;
  if (!showQuery) return false;
  return showQuery === layoutName;
}

/** Format the saved-at timestamp into a relative one-liner ("2m ago",
 *  "3h ago", "yesterday", "Apr 8"). Pure & tested independently. */
export function formatRelativeSavedAt(
  savedAt: number,
  now: number = Date.now(),
): string {
  const delta = Math.max(0, now - savedAt);
  const m = Math.floor(delta / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d}d ago`;
  // Older — show short month + day.
  const date = new Date(savedAt);
  const month = date.toLocaleString('en-US', { month: 'short' });
  return `${month} ${date.getDate()}`;
}

interface Props {
  /** When true, the section is rendered nothing (compact rail can't
   *  fit the list comfortably). Caller decides; default behaviour
   *  is "render the list". */
  compact?: boolean;
  /** Mobile drawer hook — caller wires this so the drawer auto-closes
   *  after a switch. Identical contract to SidebarNav's onNavigate. */
  onNavigate?: () => void;
}

export function ShowroomSidebarSection({ compact = false, onNavigate }: Props = {}) {
  const ctx = useContext(DaemonContext);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const showQuery = searchParams?.get('show') ?? null;
  const [layouts, setLayouts] = useState<SavedShowroomLayout[]>([]);
  const [loaded, setLoaded] = useState(false);

  // mount-effect: fetch the list once. The showroom layout itself
  // already pushes a save event (§6.5) to localStorage; cross-component
  // refresh would be a nice-to-have but is out of scope for the
  // minimum viable widget.
  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    void (async () => {
      try {
        const { layouts: out, source } = await listShowroomsHybrid(ctx.client);
        if (cancelled) return;
        debugLog('showroom.sidebar.list', { count: out.length, source });
        setLayouts(out);
      } catch (e) {
        if (cancelled) return;
        debugLog('showroom.sidebar.list.error', { error: String(e) });
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [ctx]);

  // Re-read on `storage` events so a save in another tab (or the
  // showroom itself bumping localStorage) refreshes the rail without
  // a polling timer.
  useEffect(() => {
    if (!ctx || typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent): void => {
      if (e.key && !e.key.startsWith('elanous.showroom')) return;
      void (async () => {
        try {
          const { layouts: out } = await listShowroomsHybrid(ctx.client);
          setLayouts(out);
        } catch { /* ignore */ }
      })();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [ctx]);

  // R6 FU.3 (2026-05-09) — daemon SSE subscription. Cross-device
  // saves emit `upsert` / `remove` events on the daemon's layout
  // store; we re-fetch the list whenever one lands so the rail
  // reflects state from any device without page reload. Native
  // EventSource retry policy covers daemon hiccups; the storage-
  // event listener above stays as the same-origin / same-tab path
  // (some hosts run the PWA same-origin without a daemon round-trip).
  useEffect(() => {
    if (!ctx || typeof window === 'undefined') return;
    const url = ctx.client.showroomLayoutsEventsUrl();
    if (!url) return;
    const refresh = (kind: string) => async () => {
      if (kind === 'hello') return;
      debugLog('showroom.sidebar.sse.event', { kind });
      try {
        const { layouts: out } = await listShowroomsHybrid(ctx.client);
        setLayouts(out);
      } catch { /* ignore */ }
    };
    // ⛔⭐⭐⭐ **공유 구독** — `AppShell` 이 `SidebarNav` 를 «세 자리»에 마운트하므로
    //   이 컴포넌트도 사본으로 뜬다. CSS 로 숨겨도 ***React 는 마운트하고 사본마다 연결을 연다.***
    //   ⇒ 끝나지 않는 SSE 가 HTTP/1.1 한도(6)를 먹어 ***관측 업로드가 영영 큐에 섰다***(실측).
    return subscribeSharedEventSource(url, {
      events: {
        hello: refresh('hello'),
        upsert: refresh('upsert'),
        remove: refresh('remove'),
      },
      // Native retry — no manual close on transient errors.
      onError: () => { /* noop */ },
      // ⭐ 무인 리뷰 should-fix(#11378): 공유 모듈로 옮기며 이 관측이 «사라졌었다».
      onConstructError: (e) => debugLog('showroom.sidebar.sse.construct-error', { error: String(e) }),
    });
  }, [ctx]);

  const handleClick = useCallback((name: string): void => {
    debugLog('showroom.sidebar.switch', { name });
    router.push(`/showroom?show=${encodeURIComponent(name)}` as never);
    onNavigate?.();
  }, [router, onNavigate]);

  if (compact) return null;
  if (!ctx) return null;

  return (
    <div
      className="border-t border-sidebar-border/40 px-2 py-3"
      data-testid="showroom-sidebar-section"
    >
      <div className="flex items-center justify-between px-1 pb-1">
        <span className="text-[10px] font-medium uppercase tracking-wide text-sidebar-foreground/50">
          Showrooms
        </span>
        <span className="text-[10px] text-sidebar-foreground/40">
          {layouts.length}
        </span>
      </div>
      {!loaded && layouts.length === 0 && (
        <div
          className="px-2 py-1 text-[11px] text-sidebar-foreground/40"
          data-testid="showroom-sidebar-loading"
        >
          loading…
        </div>
      )}
      {loaded && layouts.length === 0 && (
        <div
          className="px-2 py-1 text-[11px] leading-snug text-sidebar-foreground/50"
          data-testid="showroom-sidebar-empty"
        >
          Save a layout in <span className="font-medium">/showroom</span> to
          populate this rail.
        </div>
      )}
      {layouts.length > 0 && (
        <ul className="space-y-0.5">
          {layouts.slice(0, 8).map((layout) => {
            const active = isLayoutActive(layout.name, pathname, showQuery);
            return (
              <li key={layout.name}>
                <button
                  type="button"
                  onClick={() => handleClick(layout.name)}
                  data-testid={`showroom-sidebar-item-${layout.name}`}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors',
                    active
                      ? 'bg-primary/15 text-foreground font-semibold ring-1 ring-primary/40'
                      : 'text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground',
                  )}
                  aria-current={active ? 'true' : undefined}
                  title={`${layout.name} — ${layout.panels.length} panels`}
                >
                  <LayoutGrid
                    className={cn(
                      'size-3 shrink-0',
                      active ? 'text-primary' : 'text-current',
                    )}
                    aria-hidden
                  />
                  <span className="flex-1 truncate">{layout.name}</span>
                  <span className="shrink-0 text-[10px] text-sidebar-foreground/40">
                    {layout.panels.length}
                  </span>
                </button>
              </li>
            );
          })}
          {layouts.length > 8 && (
            <li
              className="px-2 py-1 text-[10px] text-sidebar-foreground/40"
              data-testid="showroom-sidebar-truncated"
            >
              + {layouts.length - 8} more (open Showroom to browse)
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
