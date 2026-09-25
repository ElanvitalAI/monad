export interface DashboardBrowserMirrorWidgetLike {
  state: Record<string, unknown>;
}

// Mirrors the shape of `FsEntry` (src/browser-pane/model.ts) — the file
// browser entry that callers actually flow through here. The runtime only
// dereferences `absPath` itself, but the `renderItem` / `renderIcon`
// callbacks callers hand in are typed `(e: FsEntry) => string` and read
// `name` / `isDir`, so the entry-like contract must carry FsEntry's full
// field set for those callbacks to remain assignable (param contravariance).
export interface DashboardBrowserMirrorEntryLike {
  name: string;
  absPath: string;
  isDir: boolean;
  size: number;
  mtime: number;
  ext: string;
}

export interface DashboardBrowserMirrorRuntime {
  projectWorkingBrowser(
    widget: DashboardBrowserMirrorWidgetLike | null | undefined,
    entries: readonly DashboardBrowserMirrorEntryLike[],
    cursor: number,
    offset: number,
    selected: ReadonlySet<string>,
    focused: boolean,
    renderItem: (entry: DashboardBrowserMirrorEntryLike) => string,
    renderIcon: (entry: DashboardBrowserMirrorEntryLike) => string,
  ): void;
  projectObsidian(
    widget: DashboardBrowserMirrorWidgetLike | null | undefined,
    obsidian: {
      available: boolean;
      root: string;
      entries: readonly DashboardBrowserMirrorEntryLike[];
      cursor: number;
      offset: number;
      selected: ReadonlySet<string>;
    },
    focused: boolean,
    renderItem: (entry: DashboardBrowserMirrorEntryLike) => string,
    renderIcon: (entry: DashboardBrowserMirrorEntryLike) => string,
    renderWarning: (text: string) => string,
    renderMuted: (text: string) => string,
  ): void;
}

function selectedNames(
  entries: readonly DashboardBrowserMirrorEntryLike[],
  selected: ReadonlySet<string>,
  renderItem: (entry: DashboardBrowserMirrorEntryLike) => string,
): Set<string> {
  const names = new Set<string>();
  for (const entry of entries) {
    if (selected.has(entry.absPath)) names.add(renderItem(entry));
  }
  return names;
}

export function createDashboardBrowserMirrorRuntime(): DashboardBrowserMirrorRuntime {
  return {
    projectWorkingBrowser(widget, entries, cursor, offset, selected, focused, renderItem, renderIcon) {
      if (!widget) return;
      widget.state.items = entries.map(renderItem);
      widget.state.icons = entries.map(renderIcon);
      widget.state.cursor = cursor;
      widget.state.offset = offset;
      widget.state.preserveAnsi = true;
      widget.state.selected = selectedNames(entries, selected, renderItem);
      widget.state.focused = focused;
    },
    projectObsidian(widget, obsidian, focused, renderItem, renderIcon, renderWarning, renderMuted) {
      if (!widget) return;
      if (!obsidian.available) {
        widget.state.items = [
          renderWarning('vault not found'),
          renderMuted(obsidian.root),
          renderMuted('set $OBSIDIAN_VAULT to point at your vault'),
        ];
        widget.state.icons = ['', '', ''];
        widget.state.cursor = 0;
        widget.state.offset = 0;
        widget.state.selected = new Set<string>();
      } else {
        widget.state.items = obsidian.entries.map(renderItem);
        widget.state.icons = obsidian.entries.map(renderIcon);
        widget.state.cursor = obsidian.cursor;
        widget.state.offset = obsidian.offset;
        widget.state.selected = selectedNames(obsidian.entries, obsidian.selected, renderItem);
      }
      widget.state.preserveAnsi = true;
      widget.state.focused = focused;
    },
  };
}
