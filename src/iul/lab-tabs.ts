import { C } from '../tui.js';
import type { KeyEvent } from '../plugins/core/types.js';
import type { MouseEvent } from '../ui/mouse-events.js';
import type { Printer } from '../ui/printer.js';
import { BoxView, Consumed, Ignored, type EventResult, type FocusSource, type Size, type View } from '../ui/view.js';
import { SelectView } from '../ui/widgets/select-view.js';
import {
  getCatalogForIulLab,
  type CatalogEntry,
} from '../playground/catalog.js';
import { buildThemeOptionEntries } from '../playground/lab.js';
import { DEFAULT_THEME_TOKENS } from '../theme/tokens.js';
import { getTheme } from '../themes/index.js';
import type { IulThemePreviewControl } from './theme-lab-lane-view.js';
import {
  createIulAssetRegistry,
  createIulAssetView,
  type IulAssetId,
  type IulAssetSpec,
} from './asset-registry.js';
import { getIulSceneRegistry } from './scene-registry.js';
import {
  IulTopControlRail,
  type IulRailControlModel,
} from '../ui/chrome/top-control-rail.js';

type TestLabFocusArea = 'theme' | 0 | 1 | 2 | 3;

export function createIulTestLabView(): View {
  return createIulTestLabViewWithThemeControl();
}

export function createIulTestLabViewWithThemeControl(
  themePreviewControl?: IulThemePreviewControl,
): View {
  const byId = new Map(getCatalogForIulLab().map((entry) => [entry.id, entry] as const));
  return new IulTestLabCompareView(byId, themePreviewControl);
}

export function createIulYamlEditorView(): View {
  const byId = new Map<string, CatalogEntry>(getCatalogForIulLab().map((entry) => [entry.id, entry] as const));
  return createIulAssetView('yaml-editor', {
    catalogById: byId,
    resolveTheme: () => DEFAULT_THEME_TOKENS,
  });
}

class IulTestLabCompareView implements View {
  private size: Size = { width: 0, height: 0 };
  private focusArea: TestLabFocusArea = 'theme';
  private themePickerCursor = 0;
  private activeThemeName: string | null = null;
  private readonly cellViews = new Map<IulAssetId, View>();
  private readonly assets: ReadonlyMap<IulAssetId, IulAssetSpec>;
  private readonly scene = getIulSceneRegistry().get('test-lab-core')!;
  private readonly themeOptions = [
    { value: '__system__', label: 'System current' },
    ...buildThemeOptionEntries().map((entry) => ({
      value: entry.name,
      label: entry.name,
    })),
  ];
  private readonly topRail = new IulTopControlRail({
    row: 1,
    resolveTheme: () => this.resolveActiveTheme(),
    controls: () => this.topRailControls(),
    onPickSelect: (id, value) => {
      if (id !== 'theme') return;
      this.activeThemeName = value === '__system__' ? null : value;
      const idx = this.themeOptions.findIndex((entry) => entry.value === value);
      this.themePickerCursor = Math.max(0, idx >= 0 ? idx : 0);
      this.cellViews.clear();
    },
  });

  constructor(
    private readonly byId: ReadonlyMap<string, CatalogEntry>,
    private readonly themePreviewControl?: IulThemePreviewControl,
  ) {
    this.assets = createIulAssetRegistry({
      catalogById: byId,
      resolveTheme: () => this.resolveActiveTheme(),
    });
    const idx = this.themeOptions.findIndex((entry) => entry.value === (this.activeThemeName ?? '__system__'));
    this.themePickerCursor = Math.max(0, idx >= 0 ? idx : 0);
  }

  draw(p: Printer): void {
    const layout = this.computeLayout(p.width, p.height);
    this.drawControls(p.sub(0, 0, p.width, layout.controlHeight, { focused: this.focusArea === 'theme' }));
    for (const cell of layout.cells) {
      const view = this.resolveCellView(cell.assetId);
      view.layout({ width: cell.width, height: cell.height });
      view.draw(p.sub(cell.x, cell.y, cell.width, cell.height, { focused: this.focusArea === cell.index }));
    }
  }

  onEvent(ev: KeyEvent): EventResult {
    const railResult = this.topRail.onEvent(ev);
    if (railResult.kind === 'consumed') return railResult;
    if (ev.name === 'tab') {
      this.focusArea = this.nextFocusArea();
      return Consumed();
    }
    if (this.focusArea === 'theme') {
      if (ev.name === 'down' || ev.name === 'j' || ev.name === 'enter') {
        if (ev.name !== 'enter') this.focusArea = 0;
        return Consumed();
      }
      return Ignored;
    }
    const activeCell = this.focusArea;
    const view = this.resolveCellView(this.scene.assetIds[activeCell]!);
    const delegated = view.onEvent(ev);
    if (delegated.kind === 'consumed') return delegated;
    switch (ev.name) {
      case 'up':
      case 'k':
        this.focusArea = activeCell >= 2 ? (activeCell - 2) as 0 | 1 : 'theme';
        return Consumed();
      case 'down':
      case 'j':
        this.focusArea = activeCell <= 1 ? (activeCell + 2) as 2 | 3 : activeCell;
        return Consumed();
      case 'left':
      case 'h':
        this.focusArea = activeCell % 2 === 1 ? (activeCell - 1) as 0 | 2 : activeCell;
        return Consumed();
      case 'right':
      case 'l':
        this.focusArea = activeCell % 2 === 0 ? (activeCell + 1) as 1 | 3 : activeCell;
        return Consumed();
      case 'escape':
        this.focusArea = 'theme';
        return Consumed();
      default:
        return Ignored;
    }
  }

  onMouse(ev: MouseEvent): EventResult {
    const layout = this.computeLayout(this.size.width, this.size.height);
    const railResult = this.topRail.onMouse(ev);
    if (railResult.kind === 'consumed') {
      this.focusArea = 'theme';
      return railResult;
    }
    if (ev.y < layout.controlHeight) {
      this.focusArea = 'theme';
      return Consumed();
    }
    const cell = layout.cells.find((candidate) =>
      ev.x >= candidate.x
      && ev.x < candidate.x + candidate.width
      && ev.y >= candidate.y
      && ev.y < candidate.y + candidate.height,
    );
    if (!cell) return Ignored;
    this.focusArea = cell.index;
    const view = this.resolveCellView(cell.assetId);
    if (!view.onMouse) return Consumed();
    const local = { ...ev, x: ev.x - cell.x, y: ev.y - cell.y, absX: ev.absX, absY: ev.absY };
    const result = view.onMouse(local);
    return result.kind === 'consumed' ? result : Consumed();
  }

  layout(size: Size): void {
    this.size = size;
    this.topRail.layout(size);
    const layout = this.computeLayout(size.width, size.height);
    for (const cell of layout.cells) {
      this.resolveCellView(cell.assetId).layout({ width: cell.width, height: cell.height });
    }
  }

  requiredSize(constraint: Size): Size {
    return {
      width: Math.min(constraint.width, Math.max(60, constraint.width)),
      height: Math.min(constraint.height, Math.max(18, constraint.height)),
    };
  }

  takeFocus(_source?: FocusSource): boolean {
    this.focusArea = 'theme';
    return true;
  }

  private drawControls(p: Printer): void {
    p.fill(' ');
    p.hline(0, '─', C.dim(''));
    p.text(1, 1, C.bold('Test Lab'));
    const focusLabel = this.focusArea === 'theme'
      ? 'Theme'
      : (this.assets.get(this.scene.assetIds[this.focusArea])?.label ?? 'Cell');
    p.text(14, 1, `${C.dim('Focus:')} ${C.accent(focusLabel)}`);
    this.topRail.layout({ width: p.width, height: p.height });
    this.topRail.draw(p);
  }

  private nextFocusArea(): TestLabFocusArea {
    if (this.focusArea === 'theme') return 0;
    return this.focusArea === 3 ? 'theme' : ((this.focusArea + 1) as 0 | 1 | 2 | 3);
  }

  private resolveCellView(assetId: IulAssetId): View {
    const cached = this.cellViews.get(assetId);
    if (cached) return cached;
    const asset = this.assets.get(assetId);
    const view = asset?.createView()
      ?? new BoxView(new ViewlessText(`Missing IUL asset: ${assetId}`), { border: true, title: assetId, titleAlign: 'center' });
    this.cellViews.set(assetId, view);
    return view;
  }

  private computeLayout(width: number, height: number): {
    width: number;
    controlHeight: number;
    cells: Array<{ index: 0 | 1 | 2 | 3; assetId: IulAssetId; x: number; y: number; width: number; height: number }>;
  } {
    const controlHeight = 3;
    const gridY = controlHeight;
    const gridHeight = Math.max(0, height - controlHeight);
    const leftWidth = Math.max(1, Math.floor(width / 2));
    const rightWidth = Math.max(0, width - leftWidth);
    const topHeight = Math.max(1, Math.floor(gridHeight / 2));
    const bottomHeight = Math.max(0, gridHeight - topHeight);
    return {
      width,
      controlHeight,
      cells: [
        { index: 0, assetId: this.scene.assetIds[0], x: 0, y: gridY, width: leftWidth, height: topHeight },
        { index: 1, assetId: this.scene.assetIds[1], x: leftWidth, y: gridY, width: rightWidth, height: topHeight },
        { index: 2, assetId: this.scene.assetIds[2], x: 0, y: gridY + topHeight, width: leftWidth, height: bottomHeight },
        { index: 3, assetId: this.scene.assetIds[3], x: leftWidth, y: gridY + topHeight, width: rightWidth, height: bottomHeight },
      ],
    };
  }

  private resolveLiveThemeName(): string {
    return this.themePreviewControl?.getActiveThemeName() ?? DEFAULT_THEME_TOKENS.name;
  }

  private resolveActiveThemeName(): string {
    return this.activeThemeName ?? this.resolveLiveThemeName();
  }

  private resolveActiveTheme() {
    return getTheme(this.resolveActiveThemeName()) ?? DEFAULT_THEME_TOKENS;
  }

  private topRailControls(): readonly IulRailControlModel[] {
    return [
      {
        kind: 'static',
        id: 'grid',
        label: 'Grid',
        valueLabel: '2x2',
      },
      {
        kind: 'select',
        id: 'theme',
        label: 'Theme',
        value: this.resolveActiveThemeName(),
        valueLabel: this.resolveActiveThemeName(),
        options: this.themeOptions,
        title: 'Theme',
        width: 34,
      },
    ] as const;
  }
}

class ViewlessText implements View {
  constructor(private readonly text: string) {}
  draw(p: Printer): void {
    p.fill(' ');
    p.text(0, 0, this.text);
  }
  onEvent(): EventResult { return Ignored; }
  layout(_size: Size): void {}
  requiredSize(constraint: Size): Size { return constraint; }
  takeFocus(_source?: FocusSource): boolean { return false; }
}
