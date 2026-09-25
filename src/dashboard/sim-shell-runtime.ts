import type { ControlSignalBus, ControlSignalScope } from '../input/control-signal.js';
import type { InputSourceRef } from '../input/input-source-kind.js';
import {
  listSimulationScenarios,
  type DashboardSimulationScenarioId,
  type SimulationScenario as DashboardSimulationScenario,
} from '../sim/catalog.js';
import { buildDashboardMediaSampleText } from './media-sample.js';

export type { DashboardSimulationScenarioId, DashboardSimulationScenario };

export interface DashboardSimulationRunResult {
  lines: string[];
  status: 'ok' | 'warning' | 'error';
  observedAt: string;
}

export interface DashboardSimulationShellRuntimeDeps {
  seedAssistantSample: (text: string) => void;
  clearAssistantSample: () => void;
  openLastAssistantMediaPreview: () => Promise<void>;
  getBrowserStatusLines: () => string[];
  getBrowserSmokeLines: () => Promise<string[]>;
  getBrowserStopLines: () => string[];
  signalBus?: ControlSignalBus;
  signalScope?: ControlSignalScope;
  source?: InputSourceRef;
}

function defaultSignalSource(): InputSourceRef {
  return { kind: 'keyboard', surface: 'dashboard-chat-main' };
}

function stampResult(
  status: DashboardSimulationRunResult['status'],
  lines: string[],
): DashboardSimulationRunResult {
  return {
    status,
    lines,
    observedAt: new Date().toISOString(),
  };
}

async function runMediaVideoStopGate(
  deps: DashboardSimulationShellRuntimeDeps,
): Promise<DashboardSimulationRunResult> {
  deps.seedAssistantSample(buildDashboardMediaSampleText('video'));
  await deps.openLastAssistantMediaPreview();
  if (deps.signalBus && deps.signalScope) {
    deps.signalBus.emit({
      kind: 'output-sink-stop',
      urgency: 'quick-pass',
      mayPreempt: true,
      source: deps.source ?? defaultSignalSource(),
      scope: deps.signalScope,
      payload: { sinkKind: 'video', reason: 'sim-shell-video-stop-gate' },
    });
  }
  await deps.openLastAssistantMediaPreview();
  return {
    ...stampResult('ok', [
      'seeded video sample',
      'opened preview once',
      'emitted output-sink-stop for video sink',
      'second open should now be preempted',
    ]),
  };
}

export function listDashboardSimulationScenarios(): readonly DashboardSimulationScenario[] {
  return listSimulationScenarios();
}

export async function runDashboardSimulationScenario(
  id: DashboardSimulationScenarioId,
  deps: DashboardSimulationShellRuntimeDeps,
): Promise<DashboardSimulationRunResult> {
  switch (id) {
    case 'media-picture-smoke':
      deps.seedAssistantSample(buildDashboardMediaSampleText('picture'));
      await deps.openLastAssistantMediaPreview();
      return stampResult('ok', [
          'seeded picture sample',
          'opened preview via dashboard media sink',
        ]);
    case 'media-video-stop-gate':
      return runMediaVideoStopGate(deps);
    case 'browser-cdp-status':
      return stampResult('ok', deps.getBrowserStatusLines());
    case 'browser-cdp-smoke':
      return stampResult('ok', await deps.getBrowserSmokeLines());
    case 'browser-cdp-stop':
      return stampResult('ok', deps.getBrowserStopLines());
    default: {
      const exhaustive: never = id;
      return stampResult('error', [`unknown scenario: ${String(exhaustive)}`]);
    }
  }
}
