import type { SidebarTabItem } from '../ui/widgets/sidebar-tab-surface.js';
import {
  buildIulSidebarItemsFromRegistry,
  type IulSidebarLaneSpec,
} from './lane-registry.js';
import {
  createIulTestLabView,
  createIulTestLabViewWithThemeControl,
  createIulYamlEditorView,
} from './lab-tabs.js';
import type { IulThemePreviewControl } from './theme-lab-lane-view.js';

export const IUL_SIDEBAR_LANES: readonly IulSidebarLaneSpec[] = [
  {
    id: 'test-lab',
    label: 'Test Lab',
    badge: 'focus',
    badgeTone: 'active',
    createContent: createIulTestLabView,
  },
  {
    id: 'yaml-editor',
    label: 'YAML Editor',
    badge: 'lab',
    badgeTone: 'new',
    createContent: createIulYamlEditorView,
  },
] as const;

export const IUL_SIDEBAR_TAB_IDS = IUL_SIDEBAR_LANES.map((lane) => lane.id);

export function buildIulSidebarItems(opts: {
  themePreviewControl?: IulThemePreviewControl;
} = {}): SidebarTabItem[] {
  return buildIulSidebarItemsFromRegistry(IUL_SIDEBAR_LANES.map((lane) => ({
    ...lane,
    createContent: lane.id === 'test-lab'
      ? () => createIulTestLabViewWithThemeControl(opts.themePreviewControl)
      : lane.createContent,
  })));
}
