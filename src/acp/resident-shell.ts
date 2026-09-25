import { stripAnsi } from '../tui.js';
import { debug } from '../debug/log.js';
import { Printer } from '../ui/printer.js';
import { toWidgetMouseEventType, type MouseEvent } from '../ui/mouse-events.js';
import { Consumed, Ignored, type EventResult, type FocusSource, type Size, type View } from '../ui/view.js';
import { Tabs } from '../ui/widgets/tabs.js';
import { mintPaneId } from '../virtual-windows/addressing.js';
import type {
  PaneBroadcast,
  PaneContent,
  PaneRenderCtx,
  PaneUnsubscribe,
} from '../virtual-windows/pane-content.js';
import type { Action, DisplayMouseEvent, KeyEvent } from '../display/types.js';
import {
  createAcpChannelBrowserPaneContent,
  type AcpChannelBrowserDeps,
} from './channel-browser-shell.js';
import { globalDualRoleManager } from './dual-role-manager.js';
import { globalBackgroundManager } from './background-manager.js';
import { globalAcpEventRouter } from './event-router.js';
import { globalAcpSessionPersistence } from './session-persistence.js';

export interface AcpResidentShellPaneContentSpec {
  kind: 'acp-shell';
  title?: string;
}

type AcpResidentTabId = 'browser' | 'history';

const ACP_RESIDENT_TABS: ReadonlyArray<{ id: AcpResidentTabId; title: string }> = [
  { id: 'browser', title: 'Browser' },
  { id: 'history', title: 'History' },
];

export function createAcpResidentShellPaneContent(
  spec: AcpResidentShellPaneContentSpec,
  deps: Partial<AcpChannelBrowserDeps> = {},
): PaneContent {
  const resolvedDeps: AcpChannelBrowserDeps = {
    dualRoleManager: deps.dualRoleManager ?? globalDualRoleManager(),
    backgroundManager: deps.backgroundManager ?? globalBackgroundManager(),
    eventRouter: deps.eventRouter ?? globalAcpEventRouter(),
    persistence: deps.persistence ?? globalAcpSessionPersistence(),
    runPrimaryAction: deps.runPrimaryAction,
    actionStatus: deps.actionStatus,
  };
  const obs = createObserver();
  let alive = true;
  let lastCtx: PaneRenderCtx = { cols: 40, rows: 12, focused: true };
  let activeTab: AcpResidentTabId = 'browser';

  const browserPane = createAcpChannelBrowserPaneContent(
    { kind: 'acp-shell', title: 'ACP Browser', scope: 'browser' },
    resolvedDeps,
  );
  const historyPane = createAcpChannelBrowserPaneContent(
    { kind: 'acp-shell', title: 'ACP History', scope: 'history' },
    resolvedDeps,
  );

  const tabs = new Tabs({
    tabs: [
      { title: 'Browser', content: new PaneContentViewAdapter(browserPane) },
      { title: 'History', content: new PaneContentViewAdapter(historyPane) },
    ],
    onChange: (idx) => {
      activeTab = ACP_RESIDENT_TABS[idx]?.id ?? 'browser';
      if (debug.enabled) {
        debug.log('acp.shell', 'tab-change', {
          activeTab,
          activeTitle: ACP_RESIDENT_TABS[idx]?.title ?? null,
        });
      }
      obs.emit();
    },
  });

  const stopBrowser = browserPane.on('update', () => {
    if (tabs.activeIndex === 0) obs.emit();
  });
  const stopHistory = historyPane.on('update', () => {
    if (tabs.activeIndex === 1) obs.emit();
  });

  const renderLines = (ctx: PaneRenderCtx): string[] => {
    tabs.layout({ width: Math.max(1, ctx.cols), height: Math.max(1, ctx.rows) });
    const printer = Printer.create({
      width: Math.max(1, ctx.cols),
      height: Math.max(1, ctx.rows),
      focused: ctx.focused,
    });
    tabs.draw(printer);
    return printer.lines();
  };

  return {
    id: mintPaneId(),
    kind: spec.kind,
    title: spec.title ?? 'ACP',
    focusPolicy: 'interactive',
    start() {
      browserPane.start();
      historyPane.start();
      if (debug.enabled) debug.log('acp.shell', 'pane-start', { title: spec.title ?? 'ACP', activeTab });
    },
    stop() {
      alive = false;
      try { browserPane.stop(); } catch { /* ignore */ }
      try { historyPane.stop(); } catch { /* ignore */ }
      if (debug.enabled) debug.log('acp.shell', 'pane-stop', { title: spec.title ?? 'ACP', activeTab });
    },
    render(ctx) {
      lastCtx = ctx;
      return renderLines(ctx).join('\n');
    },
    onKey(ev: KeyEvent): Action {
      const result = tabs.onEvent(ev);
      if (result.kind === 'consumed') {
        result.callback?.();
        obs.emit();
        return { type: 'refresh' };
      }
      return { type: 'none' };
    },
    onMouse(ev: DisplayMouseEvent): Action {
      const result = tabs.onMouse?.({
        type: toWidgetMouseEventType(ev.type),
        x: Math.max(0, ev.col - 1),
        y: Math.max(0, ev.row - 1),
        absX: Math.max(0, ev.col - 1),
        absY: Math.max(0, ev.row - 1),
        shift: ev.shift,
        ctrl: ev.ctrl,
        alt: ev.alt,
      });
      if (result?.kind === 'consumed') {
        result.callback?.();
        if (debug.enabled && ev.type !== 'motion') {
          debug.log('acp.shell', 'pane-mouse-consumed', {
            type: ev.type,
            row: ev.row,
            col: ev.col,
            activeTab,
          });
        }
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
      try { stopBrowser(); } catch { /* ignore */ }
      try { stopHistory(); } catch { /* ignore */ }
      try { browserPane.dispose(); } catch { /* ignore */ }
      try { historyPane.dispose(); } catch { /* ignore */ }
      if (debug.enabled) debug.log('acp.shell', 'pane-dispose', { title: spec.title ?? 'ACP', activeTab });
    },
  };
}

class PaneContentViewAdapter implements View {
  constructor(private readonly pane: PaneContent) {}

  draw(p: Printer): void {
    const text = this.pane.render({ cols: p.width, rows: p.height, focused: p.focused });
    const lines = text.split('\n');
    for (let i = 0; i < Math.min(lines.length, p.height); i++) {
      p.text(0, i, lines[i] ?? '');
    }
  }

  onEvent(ev: KeyEvent): EventResult {
    const result = this.pane.onKey(ev);
    return result.type === 'refresh' ? Consumed() : Ignored;
  }

  onMouse(ev: MouseEvent): EventResult {
    if (!this.pane.onMouse) return Ignored;
    const result = this.pane.onMouse({
      type: mapWidgetMouseType(ev.type),
      row: ev.y + 1,
      col: ev.x + 1,
      shift: ev.shift,
      ctrl: ev.ctrl,
      alt: ev.alt,
    });
    return result.type === 'refresh' ? Consumed() : Ignored;
  }

  layout(_size: Size): void {}

  requiredSize(constraint: Size): Size {
    return constraint;
  }

  takeFocus(_source?: FocusSource): boolean {
    return true;
  }
}

function mapWidgetMouseType(
  type: MouseEvent['type'],
): DisplayMouseEvent['type'] {
  switch (type) {
    case 'mouse-down':
      return 'click';
    case 'hover-enter':
    case 'hover-leave':
    case 'hover-over':
    case 'hover-stable':
      return 'motion';
    default:
      return type;
  }
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
