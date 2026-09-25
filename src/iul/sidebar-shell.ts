import { stripAnsi } from '../tui.js';
import { debug } from '../debug/log.js';
import { Printer } from '../ui/printer.js';
import { SidebarTabSurface } from '../ui/widgets/sidebar-tab-surface.js';
import { resolveIulSidebarShellPresentation } from '../ui/chrome/sidebar-shell-presentation.js';
import { buildIulSidebarItems, IUL_SIDEBAR_TAB_IDS } from './sidebar-shell-catalog.js';
import { mintPaneId } from '../virtual-windows/addressing.js';
import type {
  PaneBroadcast,
  PaneContent,
  PaneRenderCtx,
  PaneUnsubscribe,
} from '../virtual-windows/pane-content.js';
import type { Action, KeyEvent, DisplayMouseEvent } from '../display/types.js';
import { toWidgetMouseEventType, type MouseEvent } from '../ui/mouse-events.js';

export interface IulSidebarShellViewOptions {
  title?: string;
  footerHint?: string;
  themePreviewControl?: {
    getActiveThemeName: () => string;
    previewTheme: (name: string) => void;
    revertPreview: () => void;
    commitTheme: (name: string) => void;
  };
}

export interface IulSidebarShellPaneContentSpec {
  kind: 'iul-shell';
  title?: string;
}

export function createIulSidebarShellView(
  opts: IulSidebarShellViewOptions = {},
): SidebarTabSurface {
  const chrome = resolveIulSidebarShellPresentation();
  if (debug.enabled) {
    debug.log('iul.shell', 'view-build', {
      title: opts.title ?? chrome.title,
      tabs: [...IUL_SIDEBAR_TAB_IDS],
    });
  }
  return new SidebarTabSurface({
    title: opts.title ?? chrome.title,
    compactTitle: chrome.compactTitle,
    railTitle: chrome.railTitle,
    footerHint: opts.footerHint ?? chrome.footerHint,
    compactFooterHint: chrome.compactFooterHint,
    emptyState: chrome.emptyState,
    debugCategory: 'iul.shell',
    badgeMaxWidth: chrome.badgeMaxWidth,
    items: buildIulSidebarItems({
      themePreviewControl: opts.themePreviewControl,
    }),
  });
}

export function createIulSidebarShellPaneContent(
  spec: IulSidebarShellPaneContentSpec,
  deps: {
    iulThemePreviewControl?: IulSidebarShellViewOptions['themePreviewControl'];
  } = {},
): PaneContent {
  const view = createIulSidebarShellView({
    title: spec.title ?? 'IUL UX Lab',
    themePreviewControl: deps.iulThemePreviewControl,
  });
  const obs = createObserver();
  let alive = true;
  let lastCtx: PaneRenderCtx = { cols: 40, rows: 12, focused: true };

  const renderLines = (ctx: PaneRenderCtx): string[] => {
    view.layout({ width: Math.max(1, ctx.cols), height: Math.max(1, ctx.rows) });
    const printer = Printer.create({
      width: Math.max(1, ctx.cols),
      height: Math.max(1, ctx.rows),
      focused: ctx.focused,
    });
    view.draw(printer);
    return printer.lines();
  };

  return {
    id: mintPaneId(),
    kind: spec.kind,
    title: spec.title ?? 'IUL UX Lab',
    focusPolicy: 'interactive',
    hostChromeProfile: 'dock-only',
    start() {
      if (debug.enabled) {
        debug.log('iul.shell', 'pane-start', { title: spec.title ?? 'IUL UX Lab' });
      }
    },
    stop() {
      alive = false;
      if (debug.enabled) debug.log('iul.shell', 'pane-stop', { title: spec.title ?? 'IUL UX Lab' });
    },
    render(ctx) {
      lastCtx = ctx;
      return renderLines(ctx).join('\n');
    },
    onKey(ev: KeyEvent): Action {
      const result = view.onEvent(ev);
      if (result.kind === 'consumed') {
        if (debug.enabled) {
          debug.log('iul.shell', 'pane-key-consumed', {
            key: ev.name,
            activeId: view.activeItem?.id ?? null,
            activeIndex: view.activeIndex,
          });
        }
        obs.emit();
        return { type: 'refresh' };
      }
      return { type: 'none' };
    },
    onMouse(ev: DisplayMouseEvent) {
      if (ev.type === 'release') {
        if (debug.enabled) {
          debug.log('iul.shell', 'pane-mouse-ignored', {
            type: ev.type,
            row: ev.row,
            col: ev.col,
            reason: 'raw-release-outside-capture',
            activeId: view.activeItem?.id ?? null,
            activeIndex: view.activeIndex,
          });
        }
        return { type: 'none' };
      }
      const localX = Math.max(0, ev.col - 1);
      const localY = Math.max(0, ev.row - 1);
      const widgetEvent: MouseEvent = {
        type: toWidgetMouseEventType(ev.type),
        x: localX,
        y: localY,
        absX: localX,
        absY: localY,
        shift: ev.shift,
        ctrl: ev.ctrl,
        alt: ev.alt,
      };
      if (debug.enabled && ev.type !== 'motion') {
        debug.log('iul.shell', 'pane-mouse-forward', {
          type: ev.type,
          row: ev.row,
          col: ev.col,
          localX,
          localY,
          activeId: view.activeItem?.id ?? null,
          activeIndex: view.activeIndex,
        });
      }
      const result = view.onMouse(widgetEvent);
      if (debug.enabled && ev.type !== 'motion') {
        debug.log('iul.shell', 'pane-mouse-result', {
          type: ev.type,
          row: ev.row,
          col: ev.col,
          localX,
          localY,
          activeId: view.activeItem?.id ?? null,
          activeIndex: view.activeIndex,
          result: result.kind,
        });
      }
      if (result.kind === 'consumed') {
        obs.emit();
        return { type: 'refresh' };
      }
      return { type: 'none' };
    },
    write(_bytes) {},
    acceptBroadcast(_input: PaneBroadcast) {},
    capture() {
      return renderLines({ ...lastCtx, focused: false }).map(stripAnsi).join('\n');
    },
    get isAlive() { return alive; },
    on: obs.on,
    dispose() {
      alive = false;
      if (debug.enabled) debug.log('iul.shell', 'pane-dispose', { title: spec.title ?? 'IUL UX Lab' });
    },
  };
}

function createObserver(): {
  emit: () => void;
  on: (event: 'update' | 'output' | 'exit', cb: () => void) => PaneUnsubscribe;
} {
  const subs = new Map<'update' | 'output' | 'exit', Set<() => void>>();
  return {
    emit() {
      for (const cb of subs.get('update') ?? []) {
        try { cb(); } catch { /* ignore */ }
      }
    },
    on(event, cb) {
      const set = subs.get(event) ?? new Set<() => void>();
      set.add(cb);
      subs.set(event, set);
      return () => { set.delete(cb); };
    },
  };
}
