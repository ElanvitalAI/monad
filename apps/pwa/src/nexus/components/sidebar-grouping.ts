// PWA · NEXUS sidebar grouping logic (Phase N-4 PR ο)
//
// Pure function so it can be unit-tested without React.

import type { NexusTabKind, NexusTabState } from '../types';

// Surface-unification v2.2 V2.2-6 v2 (2026-05-11) — 'scheduler' kind
// retired (dashboard scheduler view 폐기 cascade).
export const KIND_DISPLAY_ORDER: NexusTabKind[] = [
  'chat',
  'webterm',
  'daemon',
  'pwa-host',
  'channel-bot',
];

export const KIND_DISPLAY_LABEL: Record<NexusTabKind, string> = {
  chat: 'Chat',
  webterm: 'Webterm',
  daemon: 'Daemon',
  'pwa-host': 'PWA host',
  'channel-bot': 'Channel bots',
};

export interface SidebarGroup {
  kind: NexusTabKind;
  label: string;
  tabs: NexusTabState[];
}

/** Groups tabs by kind in the canonical sidebar order. Empty groups
 *  are omitted unless `includeEmpty=true` (which the "+ chat" button
 *  row uses to render the chat header even when no chat tab exists). */
export function groupTabsForSidebar(tabs: NexusTabState[], opts: { includeEmpty?: boolean } = {}): SidebarGroup[] {
  const includeEmpty = opts.includeEmpty ?? false;
  const byKind = new Map<NexusTabKind, NexusTabState[]>();
  for (const tab of tabs) {
    const list = byKind.get(tab.spec.kind) ?? [];
    list.push(tab);
    byKind.set(tab.spec.kind, list);
  }
  const out: SidebarGroup[] = [];
  for (const kind of KIND_DISPLAY_ORDER) {
    const list = byKind.get(kind) ?? [];
    if (list.length === 0 && !includeEmpty) continue;
    list.sort((a, b) => a.spec.id.localeCompare(b.spec.id));
    out.push({ kind, label: KIND_DISPLAY_LABEL[kind], tabs: list });
  }
  return out;
}
