import { C } from '../tui.js';
import { visibleWidth, stripAnsi } from '../tui.js';
import { debug } from '../debug/log.js';
import type { KeyEvent } from '../plugins/core/types.js';
import type { MouseEvent } from '../ui/mouse-events.js';
import {
  isClickIntentMouseEventType,
  isIntentMouseEventType,
  isRawCaptureBoundaryMouseEventType,
} from '../ui/mouse-events.js';
import type { Printer } from '../ui/printer.js';
import { BoxView, Consumed, Ignored, type EventResult, type FocusSource, type Size, type View } from '../ui/view.js';
import { TextArea } from '../ui/widgets/text-area.js';
import { MenuTreeController } from '../ui/widgets/menu-tree-controller.js';
import type { CatalogEntry } from '../playground/catalog.js';
import {
  createActionPickerRecipe,
  createDockLauncherRecipe,
  createSurfaceCatalogRecipe,
  createViewPickerRecipe,
} from '../mouse-action-recipes.js';
import { buildDashboardViewPickerEntries } from '../dashboard/compact-surface-inventory.js';
import type { ViewSurfaceHandle } from '../ui/modal-adapter.js';
import type { PopupPlacement } from '../status/popups.js';
import {
  ansiForPair,
  DEFAULT_THEME_TOKENS,
  DEFAULT_WIDGET_TOKENS,
  type ThemeTokens,
} from '../theme/tokens.js';
import playgroundWidget, { type PlaygroundWidgetState } from '../playground/widget.js';
import {
  DEFAULT_SCENARIOS,
  getDefaultScenarioRegistry,
  parseScenarioYaml,
  serializeScenarioToYaml,
} from '../playground-scenario/index.js';
import {
  buildPresetOptionEntries,
  buildScenarioPaletteEntries,
  buildShowcaseEntries,
  buildThemeOptionEntries,
} from '../playground/lab.js';
import {
  IulTopControlRail,
  type IulRailControlModel,
} from '../ui/chrome/top-control-rail.js';

export type IulAssetId =
  | 'runtime.change-layout'
  | 'runtime.dock-menu'
  | 'ux.context-menu'
  | 'ux.file-dialog'
  | 'yaml-editor';

export interface IulAssetSpec {
  id: IulAssetId;
  label: string;
  summary: string;
  createView(): View;
}

export interface IulAssetBuildContext {
  catalogById: ReadonlyMap<string, CatalogEntry>;
  resolveTheme: () => ThemeTokens;
}

export function createIulAssetRegistry(
  ctx: IulAssetBuildContext,
): ReadonlyMap<IulAssetId, IulAssetSpec> {
  const assets: readonly IulAssetSpec[] = [
    {
      id: 'runtime.change-layout',
      label: 'Change layout',
      summary: 'Real dashboard action-picker substrate for layout switching, without the old inline explainer payload.',
      createView: () => createChangeLayoutRepresentativeView(ctx.resolveTheme),
    },
    {
      id: 'runtime.dock-menu',
      label: 'Dock menu',
      summary: 'Parent menu remains open while Add surface expands as a side submenu without explainer text or CTA buttons.',
      createView: () => new DockMenuRepresentativeView(ctx.resolveTheme()),
    },
    {
      id: 'ux.context-menu',
      label: 'Context Menu',
      summary: 'Compact popup action chooser.',
      createView: () => createCatalogAssetView(ctx.catalogById.get('ux.context-menu'), 'Context Menu', 'Compact popup action chooser.'),
    },
    {
      id: 'ux.file-dialog',
      label: 'File Dialog',
      summary: 'Richer chooser with chrome, body rhythm, and CTA density.',
      createView: () => createCatalogAssetView(ctx.catalogById.get('ux.file-dialog'), 'File Dialog', 'Richer chooser with chrome, body rhythm, and CTA density.'),
    },
    {
      id: 'yaml-editor',
      label: 'YAML Editor',
      summary: 'Scenario authoring surface for component composition.',
      createView: () => new IulYamlEditorView(),
    },
  ] as const;
  return new Map(assets.map((asset) => [asset.id, asset] as const));
}

export function createIulAssetView(
  assetId: IulAssetId,
  ctx: IulAssetBuildContext,
): View {
  return createIulAssetRegistry(ctx).get(assetId)?.createView()
    ?? new TextArea({ readOnly: true, text: `Missing IUL asset: ${assetId}`, wrap: true });
}

function createCatalogAssetView(
  entry: CatalogEntry | undefined,
  label: string,
  summary: string,
): View {
  const inner = resolveCatalogRepresentativeView(entry, summary);
  return new BoxView(inner, {
    border: true,
    title: label,
    titleAlign: 'center',
  });
}

function resolveCatalogRepresentativeView(
  entry: CatalogEntry | undefined,
  summary: string,
): View {
  if (entry?.view.kind === 'view') return entry.view.view;
  return new TextArea({
    readOnly: true,
    text: `${summary}\n\nCatalog entry is missing or widget-backed only.\nMount it through the shared playground catalog before promoting it into IUL assets.`,
    wrap: true,
  });
}

function createChangeLayoutRepresentativeView(
  resolveTheme: () => ThemeTokens,
): View {
  const entries = buildDashboardViewPickerEntries({
    views: [
      { id: '1', label: 'Normal', active: true },
      { id: '2', label: 'Obsidian', active: false },
      { id: '3', label: 'Skill', active: false },
      { id: '4', label: 'Agents', active: false },
      { id: '5', label: 'Debug', active: false },
      { id: '6', label: 'Scheduler', active: false },
      { id: '7', label: 'Widget Playground', active: false },
    ],
    includeRestoreAction: false,
    compactMode: 'wide',
  });
  return new MountedRecipePreviewView((size, focused) => {
    const theme = themeForPreviewFocus(resolveTheme(), focused);
    const placement: PopupPlacement = {
      anchorStartCol: 1,
      anchorEndCol: Math.max(1, size.width - 2),
      statusRow: Math.max(1, size.height - 1),
      termCols: Math.max(1, size.width),
      termRows: Math.max(1, size.height),
    };
    return createViewPickerRecipe({
      presets: entries.map((entry) => ({
        id: entry.id,
        label: entry.id.startsWith('action:')
          ? entry.label
          : entry.active
            ? `● ${entry.label}`
            : `○ ${entry.label}`,
      })),
      placement,
      onApply: () => {},
      onCancel: () => {},
      theme,
      shadow: { theme },
    });
  });
}

class IulYamlEditorView implements View {
  private readonly state: PlaygroundWidgetState;
  private size: Size | undefined;

  constructor() {
    this.state = this.buildInitialState();
  }

  draw(p: Printer): void {
    const lines = playgroundWidget.render(this.state, {
      width: p.width,
      height: p.height,
      focused: p.focused,
      originRow: 1,
      originCol: 1,
    }, 'YAML Editor');
    p.fill(' ');
    for (let y = 0; y < Math.min(lines.length, p.height); y += 1) {
      p.text(0, y, lines[y] ?? '');
    }
  }

  onEvent(ev: KeyEvent): EventResult {
    const action = playgroundWidget.onKey?.(ev, this.state, this.widgetCtx()) ?? { type: 'none' };
    return action.type === 'none' ? Ignored : Consumed();
  }

  onMouse(_ev: MouseEvent): EventResult {
    return Consumed();
  }

  layout(size: Size): void {
    this.size = size;
  }

  requiredSize(constraint: Size): Size {
    return constraint;
  }

  takeFocus(_source?: FocusSource): boolean {
    return true;
  }

  private buildInitialState(): PlaygroundWidgetState {
    const registry = getDefaultScenarioRegistry();
    if (registry.list().length === 0) registry.registerAll(DEFAULT_SCENARIOS);
    const scenario = registry.list()[0] ?? DEFAULT_SCENARIOS[0];
    const editSource = scenario ? serializeScenarioToYaml(scenario) : '';
    const themes = buildThemeOptionEntries();
    const presets = buildPresetOptionEntries();
    const showcases = buildShowcaseEntries();
    return {
      cursor: 0,
      previewSize: 'medium',
      size: 'medium',
      groupOpen: { ux: true, widget: true, modal: true },
      browserScroll: 0,
      slots: [],
      focused: true,
      mode: 'edit',
      editSource,
      editCursor: 0,
      editScrollTop: 0,
      editResult: parseScenarioYaml(editSource),
      editScenarioId: scenario?.id,
      scenarioPalette: buildScenarioPaletteEntries(registry.list()),
      scenarioPaletteCursor: 0,
      themeOptions: themes,
      themeCursor: 0,
      presetOptions: presets,
      presetCursor: 0,
      chromeAffectiveState: 'neutral',
      chromeMotionDisabled: true,
      chromeMotionMode: 'off',
      chromeVariantOverride: null,
      chromeTargetOverride: null,
      showcaseOptions: showcases,
      showcaseCursor: 0,
      activeShowcasePluginId: showcases[0]?.pluginId,
      lastRailCapture: null,
      previousRailCapture: null,
      labFeedback: null,
    };
  }

  private widgetCtx() {
    return {
      widgetId: 'iul-yaml-editor',
      widgetType: playgroundWidget.type,
      character: 'YAML Editor',
      state: this.state,
      setState: (patch: Partial<PlaygroundWidgetState>) => {
        Object.assign(this.state, patch);
      },
      requestRender: () => {},
      dismiss: () => {},
      log: () => {},
      ...(this.size !== undefined
        ? { width: this.size.width, height: this.size.height }
        : {}),
    };
  }
}

class MountedRecipePreviewView implements View {
  private size: Size = { width: 0, height: 0 };
  private handle: ViewSurfaceHandle | null = null;
  private focused = true;
  private handleFocused = true;

  constructor(
    private readonly createHandle: (size: Size, focused: boolean) => ViewSurfaceHandle,
  ) {}

  draw(p: Printer): void {
    this.focused = p.focused;
    if (!this.handle || this.handleFocused !== this.focused) {
      this.handle = this.createHandle(this.size, this.focused);
      this.handleFocused = this.focused;
    }
    const lines = renderMountedSurfaceLines(this.handle.surface.paint());
    p.fill(' ');
    for (let y = 0; y < Math.min(lines.length, p.height); y += 1) {
      p.text(0, y, lines[y] ?? '');
    }
  }

  onEvent(ev: KeyEvent): EventResult {
    if (!this.handle) return Ignored;
    return this.handle.handleKey(ev) === 'consumed' ? Consumed() : Ignored;
  }

  onMouse(ev: MouseEvent): EventResult {
    if (!this.handle) return Ignored;
    if (
      isRawCaptureBoundaryMouseEventType(ev.type)
      || ev.type === 'hover-enter'
      || ev.type === 'hover-leave'
      || ev.type === 'hover-over'
      || ev.type === 'hover-stable'
    ) {
      return Ignored;
    }
    const result = this.handle.handleMouse({
      type: ev.type,
      row: this.handle.surface.bounds.row + ev.y,
      col: this.handle.surface.bounds.col + ev.x,
      shift: ev.shift,
      ctrl: ev.ctrl,
      alt: ev.alt,
    });
    return result === 'consumed' ? Consumed() : Ignored;
  }

  layout(size: Size): void {
    this.size = size;
    this.handle = null;
  }

  requiredSize(constraint: Size): Size {
    return constraint;
  }

  takeFocus(_source?: FocusSource): boolean {
    return true;
  }
}

type DockPrototypeWindowItem = {
  id: string;
  label: string;
  description?: string;
};

type DockPrototypeSurfaceItem = {
  id: string;
  label: string;
  group?: string;
  description?: string;
};

type DockMenuPaletteMode = 'vivid' | 'soft' | 'default';

const DOCK_MENU_PALETTE_SEQUENCE: readonly DockMenuPaletteMode[] = ['vivid', 'soft', 'default'] as const;

function dockMenuPaletteLabel(mode: DockMenuPaletteMode): string {
  switch (mode) {
    case 'vivid': return 'Vivid';
    case 'soft': return 'Soft';
    case 'default': return 'Default';
  }
}

type DockPrototypeNode =
  | {
      id: 'add-window' | 'add-surface';
      label: string;
      kind: 'submenu';
      child:
        | { kind: 'window-list'; items: DockPrototypeWindowItem[] }
        | { kind: 'surface-list'; items: DockPrototypeSurfaceItem[] };
    }
  | {
      id: 'chat-only' | 'exit-program';
      label: string;
      kind: 'leaf';
    };

class DockMenuRepresentativeView implements View {
  private size: Size = { width: 0, height: 0 };
  private parentHandle: ViewSurfaceHandle | null = null;
  private childHandle: ViewSurfaceHandle | null = null;
  private focused = true;
  private paletteMode: DockMenuPaletteMode = 'vivid';
  private readonly topRail = new IulTopControlRail({
    row: 1,
    resolveTheme: () => this.withMenuAccentTheme(this.theme, 'child'),
    controls: () => this.topRailControls(),
    onPickSelect: (id, value) => {
      if (id === 'tone' && this.isPaletteMode(value)) this.paletteMode = value;
    },
  });
  private readonly windowItems: DockPrototypeWindowItem[] = [
    { id: 'browser', label: 'Browser', description: 'Pop out the browser pane as a floating window' },
    { id: 'preview', label: 'Preview', description: 'Pop out the preview pane as a floating window' },
    { id: 'agents', label: 'Agents', description: 'Pop out the agents pane as a floating window' },
  ];
  private readonly surfaceItems: DockPrototypeSurfaceItem[] = [
    { id: 'browser', label: '  Browser', group: 'Pane' },
    { id: 'preview', label: '  Preview', group: 'Pane' },
    { id: 'agents', label: '  Agents', group: 'Pane' },
    { id: 'timeline', label: '  Timeline', group: 'Pane' },
    { id: 'inspector', label: '  Inspector', group: 'Pane' },
    { id: 'events', label: '  Events', group: 'Pane' },
    { id: 'memo', label: '  Memo', group: 'Companion' },
    { id: 'clipboard', label: '  Clipboard', group: 'Companion' },
    { id: 'notes', label: '  Notes', group: 'Companion' },
    { id: 'task-board', label: '  Task Board', group: 'Companion' },
    { id: 'search', label: '  Search', group: 'Companion' },
    { id: 'vw', label: '  Virtual Window', group: 'Workspace' },
    { id: 'workspace-map', label: '  Workspace Map', group: 'Workspace' },
    { id: 'window-stack', label: '  Window Stack', group: 'Workspace' },
  ];
  private readonly nodes: DockPrototypeNode[];
  private readonly tree = new MenuTreeController({
    launcherCount: 2,
    hasChildMenu: ({ parentIndex }) => this.parentNode(parentIndex)?.kind === 'submenu',
  });

  constructor(private readonly theme: ThemeTokens) {
    this.nodes = [
      {
        id: 'add-window',
        label: 'Pop out pane',
        kind: 'submenu',
        child: { kind: 'window-list', items: this.windowItems },
      },
      {
        id: 'add-surface',
        label: 'Add surface',
        kind: 'submenu',
        child: { kind: 'surface-list', items: this.surfaceItems },
      },
      { id: 'chat-only', label: 'Chat only', kind: 'leaf' },
      { id: 'exit-program', label: 'Exit program', kind: 'leaf' },
    ];
  }

  draw(p: Printer): void {
    this.focused = p.focused;
    this.refreshHandles();
    this.topRail.layout(this.size);
    p.fill(' ');
    this.drawDockStrip(p, 0);
    this.drawDockStrip(p, 1);
    this.topRail.draw(p);
    this.drawHandle(p, this.parentHandle);
    this.drawHandle(p, this.childHandle);
  }

  onEvent(ev: KeyEvent): EventResult {
    const railResult = this.topRail.onEvent(ev);
    if (railResult.kind === 'consumed') return railResult;
    if (ev.name === 'tab') return Consumed();
    if (this.tree.handleKey(ev.name)) {
      this.refreshHandles();
      return Consumed();
    }
    const active = this.activeHandle();
    if (!active) return Ignored;
    const result = active.handleKey(ev);
    this.refreshHandles();
    return result === 'consumed' ? Consumed() : Ignored;
  }

  onMouse(ev: MouseEvent): EventResult {
    if (debug.enabled && ev.type !== 'hover-over' && ev.type !== 'hover-enter' && ev.type !== 'hover-leave' && ev.type !== 'hover-stable') {
      debug.log('iul.dock-menu', 'mouse-enter', {
        type: ev.type,
        x: ev.x,
        y: ev.y,
        parentBounds: this.parentHandle?.surface.bounds ?? null,
        childBounds: this.childHandle?.surface.bounds ?? null,
        activeRole: this.tree.activeRole,
      });
    }
    if (
      ev.type === 'hover-enter'
      || ev.type === 'hover-leave'
      || ev.type === 'hover-over'
      || ev.type === 'hover-stable'
    ) {
      return Ignored;
    }
    const dockHit = this.hitDockStrip(ev);
    if (dockHit !== null) {
      if (debug.enabled) {
        debug.log('iul.dock-menu', 'dock-strip-hit', {
          type: ev.type,
          x: ev.x,
          y: ev.y,
          launcherIndex: dockHit,
        });
      }
      if (isClickIntentMouseEventType(ev.type)) {
        this.tree.toggleLauncher(dockHit);
        this.refreshHandles();
      }
      return Consumed();
    }
    const railResult = this.topRail.onMouse(ev);
    if (railResult.kind === 'consumed') return railResult;
    const hit = this.hitHandle(ev);
    if (!hit) {
      if (debug.enabled) {
        debug.log('iul.dock-menu', 'hit-miss', {
          type: ev.type,
          x: ev.x,
          y: ev.y,
          parentBounds: this.parentHandle?.surface.bounds ?? null,
          childBounds: this.childHandle?.surface.bounds ?? null,
        });
      }
      if (this.childHandle && ev.type === 'double-click') {
        const fallbackIndex = this.rowIndexForHandle(ev.y, this.childHandle);
        if (fallbackIndex !== null && fallbackIndex >= 0) {
          if (debug.enabled) {
            debug.log('iul.dock-menu', 'child-double-click-fallback', {
              x: ev.x,
              y: ev.y,
              rowIndex: fallbackIndex,
            });
          }
          if (this.activateChildRow(fallbackIndex)) {
            this.refreshHandles();
            return Consumed();
          }
        }
      }
      return Ignored;
    }
    if (debug.enabled) {
      debug.log('iul.dock-menu', 'hit-resolved', {
        type: ev.type,
        x: ev.x,
        y: ev.y,
        role: hit.role,
        bounds: hit.handle.surface.bounds,
      });
    }
    let parentRowHit = false;
    let childRowHit: number | null = null;
    if (hit.role === 'parent' && isClickIntentMouseEventType(ev.type)) {
      const clickedIndex = this.rowIndexForHandle(ev.y, hit.handle);
      if (clickedIndex !== null) {
        this.tree.setParentCursor(clickedIndex);
        parentRowHit = true;
      }
    }
    if (hit.role === 'child' && isClickIntentMouseEventType(ev.type)) {
      const clickedIndex = this.rowIndexForHandle(ev.y, hit.handle);
      if (clickedIndex !== null) {
        this.tree.setChildCursor(clickedIndex);
        childRowHit = clickedIndex;
      }
    }
    if (!isIntentMouseEventType(ev.type)) return Consumed();
    const result = hit.handle.handleMouse({
      type: ev.type,
      row: hit.handle.surface.bounds.row + (ev.y - (hit.handle.surface.bounds.row - 1)),
      col: hit.handle.surface.bounds.col + (ev.x - (hit.handle.surface.bounds.col - 1)),
      shift: ev.shift,
      ctrl: ev.ctrl,
      alt: ev.alt,
    });
    if (hit.role === 'parent' && parentRowHit && isClickIntentMouseEventType(ev.type)) {
      this.tree.afterParentSelection();
    }
    if (hit.role === 'child' && childRowHit !== null) {
      if (debug.enabled) {
        debug.log('iul.dock-menu', 'child-pointer-hit', {
          type: ev.type,
          x: ev.x,
          y: ev.y,
          rowIndex: childRowHit,
          result,
        });
      }
      if (ev.type === 'double-click') {
        if (this.activateChildRow(childRowHit)) {
          this.refreshHandles();
          return Consumed();
        }
      }
      if (ev.type === 'click' && result !== 'consumed') {
        this.refreshHandles();
        return Consumed();
      }
    }
    this.refreshHandles();
    return result === 'consumed' ? Consumed() : Ignored;
  }

  layout(size: Size): void {
    this.size = size;
    this.topRail.layout(size);
    this.refreshHandles();
  }

  requiredSize(constraint: Size): Size {
    return constraint;
  }

  takeFocus(_source?: FocusSource): boolean {
    return true;
  }

  private activeHandle(): ViewSurfaceHandle | null {
    if (this.tree.activeRole === 'parent') return this.parentHandle;
    if (this.tree.activeRole === 'child') return this.childHandle;
    return null;
  }

  private refreshHandles(): void {
    const activeSample = this.tree.activeLauncherIndex as 0 | 1;
    this.parentHandle = this.tree.isParentOpen ? this.createParentHandle(activeSample) : null;
    this.childHandle = this.tree.isParentOpen
      && this.tree.isChildOpen
      && this.selectedParentNode()?.kind === 'submenu'
      ? this.createChildHandle(activeSample)
      : null;
  }

  private drawDockStrip(p: Printer, sample: 0 | 1): void {
    const row = sample === 0 ? 1 : Math.max(1, p.height - 2);
    const focused = this.tree.activeLauncherIndex === sample && this.tree.activeRole === 'launcher';
    const activeTheme = this.withMenuAccentTheme(this.theme, focused ? 'parent' : 'child');
    const chrome = activeTheme.widgetTokens?.modalChrome ?? DEFAULT_WIDGET_TOKENS.modalChrome!;
    const bg = ansiForPair(focused ? chrome.titleBar : (chrome.titleBarInactive ?? chrome.titleBar));
    const fg = ansiForPair(focused ? chrome.titleText : (chrome.titleTextInactive ?? chrome.titleText));
    const width = Math.min(p.width - 4, 26);
    p.text(2, row, `${bg}${' '.repeat(Math.max(0, width))}\x1b[0m`);
    const label = focused ? `${C.accent('▸')} ${C.bold('Menu')}` : `${C.muted('○')} Menu`;
    p.text(3, row, `${fg}${label}  Add surface ▸\x1b[0m`);
  }

  private hitDockStrip(ev: MouseEvent): 0 | 1 | null {
    const topRow = 1;
    const bottomRow = Math.max(1, this.size.height - 2);
    const inCols = ev.x >= 2 && ev.x < 26;
    if (!inCols) return null;
    if (ev.y === topRow) return 0;
    if (ev.y === bottomRow) return 1;
    return null;
  }

  private selectedParentNode(): DockPrototypeNode | null {
    return this.parentNode(this.tree.getParentCursor());
  }

  private parentNode(index: number): DockPrototypeNode | null {
    return this.nodes[index] ?? null;
  }

  private createParentHandle(sample: 0 | 1): ViewSurfaceHandle {
    return createDockLauncherRecipe({
      placement: this.parentPlacement(sample),
      items: this.nodes.map((node) => ({ value: node.id, label: node.label })),
      onPick: (action) => {
        const node = this.nodes.find((candidate) => candidate.id === action);
        if (node?.kind === 'submenu') this.tree.openChild();
        else this.tree.dismiss();
      },
      onCancel: () => this.tree.dismiss(),
      theme: this.withMenuAccentTheme(themeForPreviewFocus(this.theme, this.focused), 'parent'),
      shadow: { theme: this.theme },
      actionButtons: false,
      initialIndex: this.tree.getParentCursor(sample),
      onSelectionChange: (index: number) => {
        this.tree.setParentCursor(index, sample);
      },
    });
  }

  private createChildHandle(sample: 0 | 1): ViewSurfaceHandle {
    const node = this.selectedParentNode();
    if (!node || node.kind !== 'submenu') {
      return createActionPickerRecipe({
        placement: this.childPlacement(sample),
        title: 'Submenu',
        items: [],
        onPick: () => {},
        onCancel: () => this.tree.closeChild(),
        actionButtons: false,
        theme: this.withMenuAccentTheme(themeForPreviewFocus(this.theme, this.focused), 'child'),
        shadow: { theme: this.theme },
      });
    }
    if (node.child.kind === 'window-list') {
      return createActionPickerRecipe({
        placement: this.childPlacement(sample),
        title: 'Pop out pane',
        items: node.child.items.map((item) => ({
          value: item.id,
          label: item.label,
        })),
        onPick: () => this.tree.dismiss(),
        onCancel: () => this.tree.closeChild(),
        actionButtons: false,
        filterable: false,
        initialIndex: this.tree.getChildCursor(sample),
        onSelectionChange: (index: number) => {
          this.tree.setChildCursor(index, sample);
        },
        theme: this.withMenuAccentTheme(themeForPreviewFocus(this.theme, this.focused), 'child'),
        shadow: { theme: this.theme },
      });
    }
    return createSurfaceCatalogRecipe({
      placement: this.childPlacement(sample),
      surfaces: node.child.items,
      onPick: () => this.tree.dismiss(),
      onCancel: () => this.tree.closeChild(),
      theme: this.withMenuAccentTheme(themeForPreviewFocus(this.theme, this.focused), 'child'),
      shadow: { theme: this.theme },
      actionButtons: false,
      filterable: false,
      initialIndex: this.tree.getChildCursor(sample),
      onSelectionChange: (index: number) => {
        this.tree.setChildCursor(index, sample);
      },
    });
  }

  private parentPlacement(sample: 0 | 1): PopupPlacement {
    const anchorWidth = Math.max(18, Math.floor(this.size.width * 0.32));
    return {
      anchorStartCol: 2,
      anchorEndCol: Math.max(2, anchorWidth),
      statusRow: sample === 0 ? 2 : Math.max(4, this.size.height - 2),
      termCols: Math.max(1, this.size.width),
      termRows: Math.max(1, this.size.height),
    };
  }

  private childPlacement(sample: 0 | 1): PopupPlacement {
    const parent = this.parentHandle ?? this.createParentHandle(sample);
    const selectedRow = Math.min(this.size.height - 1, parent.surface.bounds.row + 1 + this.tree.getParentCursor(sample));
    const childWidth = Math.max(24, Math.floor(this.size.width * 0.46));
    const foregroundGap = 2;
    const foregroundLift = 1;
    const childStartCol = Math.max(1, parent.surface.bounds.col + parent.surface.bounds.width + foregroundGap);
    const childStatusRow = Math.max(2, selectedRow - foregroundLift);
    return {
      anchorStartCol: childStartCol,
      anchorEndCol: Math.max(1, childStartCol + childWidth),
      statusRow: childStatusRow,
      termCols: Math.max(1, this.size.width),
      termRows: Math.max(1, this.size.height),
    };
  }

  private hitHandle(ev: MouseEvent): { role: 'parent' | 'child'; handle: ViewSurfaceHandle } | null {
    for (const candidate of [
      this.childHandle ? { role: 'child' as const, handle: this.childHandle } : null,
      this.parentHandle ? { role: 'parent' as const, handle: this.parentHandle } : null,
    ]) {
      if (!candidate) continue;
      const { bounds } = candidate.handle.surface;
      if (
        ev.x >= bounds.col - 1
        && ev.x < bounds.col - 1 + bounds.width
        && ev.y >= bounds.row - 1
        && ev.y < bounds.row - 1 + bounds.height
      ) {
        return candidate;
      }
    }
    return null;
  }

  private drawHandle(p: Printer, handle: ViewSurfaceHandle | null): void {
    if (!handle) return;
    const lines = renderMountedSurfaceLines(handle.surface.paint());
    const x = Math.max(0, handle.surface.bounds.col - 1);
    const y = Math.max(0, handle.surface.bounds.row - 1);
    for (let row = 0; row < lines.length && y + row < p.height; row += 1) {
      p.text(x, y + row, lines[row] ?? '');
    }
  }

  private rowIndexForHandle(localY: number, handle: ViewSurfaceHandle): number | null {
    const idx = localY - handle.surface.bounds.row;
    if (idx < 0) return null;
    return idx;
  }

  private activateChildRow(rowIndex: number): boolean {
    const node = this.selectedParentNode();
    if (!node || node.kind !== 'submenu') return false;
    const entry = this.childRowEntries(node)[rowIndex];
    if (debug.enabled) {
      debug.log('iul.dock-menu', 'child-activate-attempt', {
        rowIndex,
        hasNode: !!node,
        entryHeading: entry?.heading ?? null,
        entryValue: entry?.value ?? null,
      });
    }
    if (!entry || entry.heading) return false;
    this.tree.dismiss();
    if (debug.enabled) {
      debug.log('iul.dock-menu', 'child-activate-commit', {
        rowIndex,
        value: entry.value ?? null,
      });
    }
    return true;
  }

  private childRowEntries(node: DockPrototypeNode): Array<{ heading: boolean; value?: string }> {
    if (node.kind !== 'submenu') return [];
    if (node.child.kind === 'window-list') {
      return node.child.items.map((item) => ({ heading: false, value: item.id }));
    }
    const rows: Array<{ heading: boolean; value?: string }> = [];
    let lastGroup = '';
    for (const surface of node.child.items) {
      const group = surface.group?.trim() ?? '';
      if (group && group !== lastGroup) {
        rows.push({ heading: true });
        lastGroup = group;
      }
      rows.push({ heading: false, value: surface.id });
    }
    return rows;
  }

  private withMenuAccentTheme(theme: ThemeTokens, role: 'parent' | 'child'): ThemeTokens {
    if (!theme.widgetTokens) return theme;
    const palette = (() => {
      switch (this.paletteMode) {
        case 'soft':
          return {
            selectedBg: role === 'parent' ? '#f5c2e7' : '#94e2d5',
            hoveredBg: role === 'parent' ? '#f9e2af' : '#b8f2ea',
            selectedFg: '#1e1e2e',
          };
        case 'default':
          return {
            selectedBg: role === 'parent' ? '#45475a' : '#313244',
            hoveredBg: role === 'parent' ? '#585b70' : '#45475a',
            selectedFg: '#cdd6f4',
          };
        case 'vivid':
        default:
          return {
            selectedBg: role === 'parent' ? '#f38ba8' : '#74c7ec',
            hoveredBg: role === 'parent' ? '#f5bde6' : '#8bd5ca',
            selectedFg: '#1e1e2e',
          };
      }
    })();
    return {
      ...theme,
      widgetTokens: {
        ...theme.widgetTokens,
        selectView: {
          ...theme.widgetTokens.selectView,
          cursor: {
            ...theme.widgetTokens.selectView.cursor,
            fg: palette.selectedFg,
            bg: palette.selectedBg,
            bold: true,
          },
          selected: {
            ...theme.widgetTokens.selectView.selected,
            fg: palette.selectedFg,
            bg: palette.selectedBg,
            bold: true,
          },
          hovered: {
            ...(theme.widgetTokens.selectView.hovered ?? theme.widgetTokens.selectView.selected),
            fg: palette.selectedFg,
            bg: palette.hoveredBg,
          },
          description: {
            ...(theme.widgetTokens.selectView.description ?? theme.widgetTokens.selectView.muted),
            fg: theme.widgetTokens.selectView.description?.fg ?? theme.colors.muted,
          },
        },
      },
    };
  }

  private topRailControls(): readonly IulRailControlModel[] {
    return [
      {
        kind: 'select',
        id: 'tone',
        label: 'Tone',
        value: this.paletteMode,
        valueLabel: dockMenuPaletteLabel(this.paletteMode),
        title: 'Tone',
        width: 18,
        options: DOCK_MENU_PALETTE_SEQUENCE.map((mode) => ({
          value: mode,
          label: dockMenuPaletteLabel(mode),
        })),
      },
    ];
  }

  private isPaletteMode(value: string): value is DockMenuPaletteMode {
    return DOCK_MENU_PALETTE_SEQUENCE.includes(value as DockMenuPaletteMode);
  }
}

function renderMountedSurfaceLines(output: string): string[] {
  const moveRe = /\x1b\[(\d+);(\d+)H/g;
  const segments: Array<{ row: number; col: number; text: string }> = [];
  let match: RegExpExecArray | null;
  let prevRow = 1;
  let prevCol = 1;
  let prevEnd = 0;
  while ((match = moveRe.exec(output)) !== null) {
    if (prevEnd !== 0) {
      segments.push({ row: prevRow, col: prevCol, text: output.slice(prevEnd, match.index) });
    }
    prevRow = Number(match[1]);
    prevCol = Number(match[2]);
    prevEnd = moveRe.lastIndex;
  }
  if (prevEnd !== 0) {
    segments.push({ row: prevRow, col: prevCol, text: output.slice(prevEnd) });
  }
  if (segments.length === 0) return output.length > 0 ? [stripAnsi(output)] : [];
  const baseRow = Math.min(...segments.map((s) => s.row));
  const baseCol = Math.min(...segments.map((s) => s.col));
  const rows = new Map<number, string>();
  for (const seg of segments) {
    const idx = seg.row - baseRow;
    const current = rows.get(idx) ?? '';
    const targetCol = Math.max(0, seg.col - baseCol);
    const currentWidth = visibleWidth(stripAnsi(current));
    const pad = targetCol > currentWidth ? ' '.repeat(targetCol - currentWidth) : '';
    rows.set(idx, `${current}${pad}${seg.text}`);
  }
  const maxIdx = Math.max(...rows.keys());
  const out: string[] = [];
  for (let i = 0; i <= maxIdx; i += 1) out.push(rows.get(i) ?? '');
  return out;
}

function themeForPreviewFocus(theme: ThemeTokens, focused: boolean): ThemeTokens {
  if (focused) return theme;
  const chrome = theme.widgetTokens?.modalChrome ?? DEFAULT_WIDGET_TOKENS.modalChrome!;
  return {
    ...theme,
    widgetTokens: {
      ...(theme.widgetTokens ?? DEFAULT_WIDGET_TOKENS),
      modalChrome: {
        ...chrome,
        titleBar: {
          ...(chrome.titleBarInactive ?? chrome.titleBar),
          fg: chrome.titleBarInactive?.fg ?? theme.colors.dim,
        },
        titleText: {
          ...(chrome.titleTextInactive ?? chrome.titleText),
          fg: chrome.titleTextInactive?.fg ?? theme.colors.dim,
        },
        borderActive: {
          ...(chrome.borderInactive ?? chrome.borderActive),
          fg: chrome.borderInactive?.fg ?? theme.colors.dim,
        },
      },
    },
  };
}
