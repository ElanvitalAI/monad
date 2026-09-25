// PWA · NEXUS sidebar single-tab row (Phase N-4 PR ο · T2.B setup badge)

'use client';

import type { NexusTabState } from '../types';
import { StatusBadge } from './status-badge';

export interface SidebarTabItemProps {
  tab: NexusTabState;
  active?: boolean;
  onClick?: (id: string) => void;
}

// T2.B — channel-bot 탭의 meta.disabled flag 감지. ChannelBotMeta 와
// 같은 모양 (src/nexus/kinds/channel-bot.ts) — duck-typed read so 다른
// kind 가 같은 flag 를 쓰면 자연스럽게 동일한 UX 적용.
export function isSetupNeeded(tab: NexusTabState): boolean {
  const meta = tab.spec.meta as { disabled?: unknown } | undefined;
  return meta?.disabled === true;
}

export function SidebarTabItem({ tab, active, onClick }: SidebarTabItemProps) {
  const setupNeeded = isSetupNeeded(tab);
  return (
    <button
      type="button"
      onClick={() => onClick?.(tab.spec.id)}
      className={[
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm rounded-md',
        'transition-colors hover:bg-accent',
        active ? 'bg-accent font-medium' : '',
      ].join(' ')}
      aria-current={active ? 'true' : undefined}
    >
      <StatusBadge status={tab.status} />
      <span className="flex-1 truncate">{tab.spec.label}</span>
      {setupNeeded && (
        <span
          data-testid={`sidebar-setup-needed-${tab.spec.id}`}
          className="text-xs text-amber-500"
          title="Setup needed — click to see setup guide"
          aria-label="Setup needed"
        >
          ⚠
        </span>
      )}
      {tab.restartCount > 0 && (
        <span className="text-xs text-muted-foreground" title={`${tab.restartCount} restarts in 1h window`}>
          ×{tab.restartCount}
        </span>
      )}
    </button>
  );
}
