import { stripAnsi } from '../tui.js';
import { C } from '../tui.js';
import { debug } from '../debug/log.js';
import { Printer } from '../ui/printer.js';
import { SidebarTabSurface, type SidebarTabItem } from '../ui/widgets/sidebar-tab-surface.js';
import {
  isPrimaryClickMouseEventType,
  toWidgetMouseEventType,
  type MouseEvent,
} from '../ui/mouse-events.js';
import { Consumed, Ignored, type EventResult, type FocusSource, type Size, type View } from '../ui/view.js';
import { mintPaneId } from '../virtual-windows/addressing.js';
import type {
  PaneBroadcast,
  PaneContent,
  PaneRenderCtx,
  PaneUnsubscribe,
} from '../virtual-windows/pane-content.js';
import type { Action, DisplayMouseEvent, KeyEvent } from '../display/types.js';
import {
  listDashboardSimulationScenarios,
  runDashboardSimulationScenario,
  type DashboardSimulationRunResult,
  type DashboardSimulationScenario,
  type DashboardSimulationShellRuntimeDeps,
} from './sim-shell-runtime.js';

export interface SimShellPaneContentSpec {
  kind: 'sim-shell';
  title?: string;
}

export function createSimShellPaneContent(
  spec: SimShellPaneContentSpec,
  deps: DashboardSimulationShellRuntimeDeps,
): PaneContent {
  const obs = createObserver();
  let alive = true;
  let lastCtx: PaneRenderCtx = { cols: 48, rows: 16, focused: true };
  let latestRunResult: DashboardSimulationRunResult | null = null;
  let latestRunScenarioId: string | null = null;
  let runCount = 0;
  const runHistory = new Map<string, DashboardSimulationRunResult[]>();

  const handleRunScenario = async (scenario: DashboardSimulationScenario) => {
    if (debug.enabled) {
      debug.log('sim.shell', 'scenario-run.begin', { id: scenario.id, family: scenario.family });
    }
    latestRunScenarioId = scenario.id;
    runCount += 1;
    latestRunResult = {
      status: 'ok',
      lines: ['running scenario...'],
      observedAt: new Date().toISOString(),
    };
    obs.emit();
    try {
      latestRunResult = await runDashboardSimulationScenario(scenario.id, deps);
      const nextHistory = [...(runHistory.get(scenario.id) ?? []), latestRunResult].slice(-5);
      runHistory.set(scenario.id, nextHistory);
      if (debug.enabled) {
        debug.log('sim.shell', 'scenario-run.ok', {
          id: scenario.id,
          lines: latestRunResult.lines.length,
          status: latestRunResult.status,
        });
      }
    } catch (error) {
      latestRunResult = {
        status: 'error',
        lines: [error instanceof Error ? error.message : String(error)],
        observedAt: new Date().toISOString(),
      };
      const nextHistory = [...(runHistory.get(scenario.id) ?? []), latestRunResult].slice(-5);
      runHistory.set(scenario.id, nextHistory);
      if (debug.enabled) {
        debug.log('sim.shell', 'scenario-run.error', {
          id: scenario.id,
          message: error instanceof Error ? error.message : String(error),
        }, { level: 'error' });
      }
    }
    obs.emit();
  };

  const items: SidebarTabItem[] = listDashboardSimulationScenarios().map((scenario) => ({
    id: scenario.id,
    label: scenario.label,
    badge: scenario.badge,
    badgeTone: scenario.family === 'media' ? 'new' : 'srv',
    description: scenario.summary,
    content: () => new SimulationScenarioDetailView({
      scenario,
      getLatestRunResult: () => latestRunScenarioId === scenario.id ? latestRunResult : null,
      getRunCount: () => latestRunScenarioId === scenario.id ? runCount : 0,
      getRunHistory: () => runHistory.get(scenario.id) ?? [],
      onRun: () => { void handleRunScenario(scenario); },
    }),
  }));

  const view = new SidebarTabSurface({
    title: spec.title ?? 'Test Simulator',
    compactTitle: 'Simulator',
    railTitle: 'Scenarios',
    footerHint: 'Enter run · Tab detail · Esc rail',
    compactFooterHint: 'Enter run',
    emptyState: 'No simulation scenarios.',
    debugCategory: 'sim.shell',
    items,
    onActivateItem: (active) => {
      const scenario = listDashboardSimulationScenarios().find((item) => item.id === active.id);
      if (scenario) void handleRunScenario(scenario);
    },
  });

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
    title: spec.title ?? 'Test Simulator',
    focusPolicy: 'interactive',
    hostChromeProfile: 'hud-status-input-dock',
    start() {
      if (debug.enabled) debug.log('sim.shell', 'pane-start', { title: spec.title ?? 'Test Simulator' });
    },
    stop() {
      alive = false;
      if (debug.enabled) debug.log('sim.shell', 'pane-stop', { title: spec.title ?? 'Test Simulator' });
    },
    render(ctx) {
      lastCtx = ctx;
      return renderLines(ctx).join('\n');
    },
    onKey(ev: KeyEvent): Action {
      const result = view.onEvent(ev);
      if (result.kind === 'consumed') {
        obs.emit();
        return { type: 'refresh' };
      }
      return { type: 'none' };
    },
    onMouse(ev: DisplayMouseEvent): Action {
      const result = view.onMouse({
        type: toWidgetMouseEventType(ev.type),
        x: Math.max(0, ev.col - 1),
        y: Math.max(0, ev.row - 1),
        absX: Math.max(0, ev.col - 1),
        absY: Math.max(0, ev.row - 1),
        shift: ev.shift,
        ctrl: ev.ctrl,
        alt: ev.alt,
      });
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
      if (debug.enabled) debug.log('sim.shell', 'pane-dispose', { title: spec.title ?? 'Test Simulator' });
    },
  };
}

interface SimulationScenarioDetailViewOpts {
  scenario: DashboardSimulationScenario;
  getLatestRunResult: () => DashboardSimulationRunResult | null;
  getRunCount: () => number;
  getRunHistory: () => readonly DashboardSimulationRunResult[];
  onRun: () => void;
}

class SimulationScenarioDetailView implements View {
  private size: Size = { width: 0, height: 0 };

  constructor(private readonly opts: SimulationScenarioDetailViewOpts) {}

  draw(p: Printer): void {
    const result = this.opts.getLatestRunResult();
    const runCount = this.opts.getRunCount();
    const history = this.opts.getRunHistory();
    const lines = [
      C.bold(this.opts.scenario.label),
      C.muted(this.opts.scenario.summary),
      '',
      C.accent('Targets'),
      C.text(`  ${this.opts.scenario.targets.join(' · ')}`),
      C.muted(`  inject=${this.opts.scenario.injectKind} · observe=${this.opts.scenario.primaryObserveSurface}`),
      '',
      C.accent('Flow map'),
      ...buildScenarioFlowMap(this.opts.scenario.flow).map((line) => C.text(`  ${line}`)),
      '',
      C.accent('Prerequisites'),
      ...this.opts.scenario.prerequisites.map((line) => C.text(`  • ${line}`)),
      '',
      C.accent('Observe'),
      ...this.opts.scenario.observe.map((line) => C.text(`  • ${line}`)),
      '',
      C.accent('Expected'),
      ...this.opts.scenario.expected.map((line) => C.text(`  • ${line}`)),
      '',
      C.success('[ Enter ] Run scenario'),
      C.muted('  double-click in rail also runs immediately'),
      '',
      C.accent('Last result'),
      C.muted(`  runs: ${runCount}`),
      ...(result ? [C.muted(`  at: ${result.observedAt}`)] : []),
      ...(result
        ? result.lines.map((line) => {
            if (result.status === 'error') return C.warning(`  ${line}`);
            if (result.status === 'warning') return C.warning(`  ${line}`);
            return C.muted(`  ${line}`);
          })
        : [C.muted('  (not run yet)')]),
      '',
      C.accent('Recent history'),
      ...(history.length > 0
        ? history.map((entry) => {
            const tone = entry.status === 'error' || entry.status === 'warning' ? C.warning : C.muted;
            return tone(`  ${entry.observedAt} · ${entry.status} · ${entry.lines[0] ?? '(empty)'}`);
          })
        : [C.muted('  (no history yet)')]),
    ];
    for (let i = 0; i < Math.min(lines.length, p.height); i++) {
      p.text(0, i, truncateDisplay(lines[i] ?? '', p.width));
    }
  }

  onEvent(ev: KeyEvent): EventResult {
    if (ev.name === 'enter' || ev.name === 'space') {
      this.opts.onRun();
      return Consumed();
    }
    return Ignored;
  }

  onMouse(ev: MouseEvent): EventResult {
    if (isPrimaryClickMouseEventType(ev.type) && ev.y >= 18 && ev.y <= 21) {
      this.opts.onRun();
      return Consumed();
    }
    return Ignored;
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
}

function truncateDisplay(text: string, width: number): string {
  if (width <= 0) return '';
  if (text.length <= width) return text;
  if (width <= 1) return text.slice(0, width);
  return `${text.slice(0, width - 1)}…`;
}

function buildScenarioFlowMap(flow: readonly string[]): string[] {
  if (flow.length === 0) return ['(no flow)'];
  const lines: string[] = [];
  for (let i = 0; i < flow.length; i++) {
    lines.push(`┌─ ${flow[i]}`);
    if (i < flow.length - 1) {
      lines.push('└→');
    }
  }
  return lines;
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
