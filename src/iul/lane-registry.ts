import type { SidebarTabItem, SidebarTabItem as SidebarItem } from '../ui/widgets/sidebar-tab-surface.js';
import type { View } from '../ui/view.js';
import type { SidebarShellBadgeTone } from '../ui/chrome/sidebar-shell-badges.js';

export interface IulSidebarLaneSpec {
  id: string;
  label: string;
  badge?: string;
  badgeTone?: SidebarShellBadgeTone;
  presentation?: () => Partial<Pick<SidebarTabItem, 'badge' | 'badgeTone' | 'description'>>;
  createContent: () => View;
}

export function buildIulSidebarItemsFromRegistry(
  lanes: readonly IulSidebarLaneSpec[],
): SidebarTabItem[] {
  return lanes.map<SidebarItem>((lane) => ({
    id: lane.id,
    label: lane.label,
    badge: lane.badge,
    badgeTone: lane.badgeTone,
    presentation: lane.presentation,
    content: lane.createContent(),
  }));
}
