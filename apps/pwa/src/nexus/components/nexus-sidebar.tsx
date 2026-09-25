// PWA · NEXUS sidebar — kind-grouped tab list (Phase N-4 PR ο)
//
// Subscribes to NexusSnapshot via React Query · groups tabs by kind
// in canonical sidebar order · highlights the active tab · exposes a
// "+ chat" button that POSTs a new chat tab via useCreateTab.
//
// Wiring: drop into the existing AppShell's sidebar slot.
// <NexusProvider client={...}> wraps once at the root.

'use client';

import { useNexusSnapshot } from '../hooks/use-nexus-state';
import { useCreateTab } from '../hooks/use-tab-actions';
import { useNexusEvents } from '../hooks/use-events';
import { groupTabsForSidebar, KIND_DISPLAY_LABEL } from './sidebar-grouping';
import { SidebarTabItem } from './sidebar-tab-item';
import type { NexusTabKind } from '../types';

export interface NexusSidebarProps {
  activeId?: string;
  onSelect?: (id: string) => void;
  /** Hide groups that have zero tabs. Default false (chat/webterm/daemon
   *  show empty headers so '+ chat' makes sense). */
  hideEmptyGroups?: boolean;
}

const QUICK_CREATE_KINDS: NexusTabKind[] = ['chat', 'webterm'];

export function NexusSidebar({ activeId, onSelect, hideEmptyGroups }: NexusSidebarProps) {
  const { data, isLoading, error } = useNexusSnapshot();
  const createTab = useCreateTab();
  // Subscribe to SSE events so the sidebar refreshes without polling.
  useNexusEvents();

  if (isLoading) return <div className="p-3 text-sm text-muted-foreground">Loading nexus…</div>;
  if (error) return <div className="p-3 text-sm text-rose-500">Nexus unreachable</div>;

  const groups = groupTabsForSidebar(data?.tabs ?? [], { includeEmpty: !hideEmptyGroups });

  return (
    <nav className="flex flex-col gap-3 p-2">
      {groups.map((group) => (
        <div key={group.kind} className="flex flex-col gap-1">
          <div className="flex items-center justify-between px-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</h3>
            {QUICK_CREATE_KINDS.includes(group.kind) && (
              <button
                type="button"
                onClick={() => createTab.mutate({ kind: group.kind })}
                disabled={createTab.isPending}
                className="text-xs px-1.5 py-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                aria-label={`Create new ${KIND_DISPLAY_LABEL[group.kind].toLowerCase()} tab`}
              >
                + new
              </button>
            )}
          </div>
          {group.tabs.length === 0
            ? <div className="px-3 py-1.5 text-xs text-muted-foreground italic">none</div>
            : group.tabs.map((tab) => (
                <SidebarTabItem
                  key={tab.spec.id}
                  tab={tab}
                  active={tab.spec.id === activeId}
                  {...(onSelect ? { onClick: onSelect } : {})}
                />
              ))}
        </div>
      ))}
      {createTab.isError && (
        <div className="px-3 py-1.5 text-xs text-rose-500">
          {(createTab.error as Error).message}
        </div>
      )}
    </nav>
  );
}
