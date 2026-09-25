// PWA · TabDetail — kind dispatch + status panel + actions (Phase N-4 PR π)

'use client';

import { useNexusTab } from '../hooks/use-nexus-state';
import { TabStatusPanel } from './tab-status-panel';
import { TabActions } from './tab-actions';
import { pickDetailComponent } from './detail-views';

export interface TabDetailProps {
  id: string;
}

export function TabDetail({ id }: TabDetailProps) {
  const { data, isLoading, error } = useNexusTab(id);

  if (!id) return <div className="p-4 text-muted-foreground text-sm">Select a tab from the sidebar.</div>;
  if (isLoading) return <div className="p-4 text-muted-foreground text-sm">Loading {id}…</div>;
  if (error) return <div className="p-4 text-rose-600 text-sm">Failed to load tab: {(error as Error).message}</div>;
  if (!data?.tab) return <div className="p-4 text-muted-foreground text-sm">Tab {id} not found.</div>;

  const tab = data.tab;
  const Detail = pickDetailComponent(tab.spec.kind);

  return (
    <section className="flex flex-col h-full p-4 overflow-y-auto">
      <TabStatusPanel tab={tab} />
      <TabActions tab={tab} />
      <Detail tab={tab} />
    </section>
  );
}
