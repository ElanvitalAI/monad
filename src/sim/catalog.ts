export type DashboardSimulationScenarioId =
  | 'media-picture-smoke'
  | 'media-video-stop-gate'
  | 'browser-cdp-status'
  | 'browser-cdp-smoke'
  | 'browser-cdp-stop';

export interface SimulationScenario {
  id: DashboardSimulationScenarioId;
  family: 'media' | 'browser-cdp';
  label: string;
  badge: string;
  summary: string;
  prerequisites: string[];
  targets: Array<'dashboard' | 'pwa' | 'browser-cdp'>;
  injectKind: 'local-action' | 'signal-sequence';
  primaryObserveSurface: 'vw-detail' | 'preview-modal' | 'chat-log' | 'control-signals';
  flow: string[];
  observe: string[];
  expected: string[];
}

const SIMULATION_SCENARIOS: readonly SimulationScenario[] = [
  {
    id: 'media-picture-smoke',
    family: 'media',
    label: 'Picture smoke',
    badge: 'MEDIA',
    summary: 'Inject a synthetic picture output and preview it through the media sink.',
    prerequisites: [
      'Dashboard chat view is available',
      'Preview modal can open on this machine',
    ],
    targets: ['dashboard', 'pwa'],
    injectKind: 'local-action',
    primaryObserveSurface: 'preview-modal',
    flow: [
      'Inject picture sample into last assistant output',
      'Open preview with preview-modal-first path',
      'Fall back to external open only if preview surface declines',
    ],
    observe: [
      'Preview modal should open immediately',
      'Chat log should record a preview success line',
    ],
    expected: [
      'picture-ref typed block is selected',
      'dashboard media preview runtime stays runnable with one action',
    ],
  },
  {
    id: 'media-video-stop-gate',
    family: 'media',
    label: 'Video stop gate',
    badge: 'MEDIA',
    summary: 'Inject a video preview, then demonstrate that output-sink-stop preempts a second open.',
    prerequisites: [
      'Dashboard control-signal bus is mounted',
      'Media preview runtime is available',
    ],
    targets: ['dashboard', 'pwa'],
    injectKind: 'signal-sequence',
    primaryObserveSurface: 'chat-log',
    flow: [
      'Inject video sample into last assistant output',
      'Open video preview once',
      'Emit output-sink-stop for video sink on dashboard scope',
      'Try opening again and expect preemption',
    ],
    observe: [
      'First open should succeed',
      'Second open should be blocked by sink policy',
    ],
    expected: [
      'video sink is routed through control-signal gate',
      'sink policy remains scoped, not global',
    ],
  },
  {
    id: 'browser-cdp-status',
    family: 'browser-cdp',
    label: 'Status',
    badge: 'CDP',
    summary: 'Show whether browser/CDP is available or cleanly degraded.',
    prerequisites: [
      'None — degraded mode is valid',
    ],
    targets: ['dashboard', 'browser-cdp'],
    injectKind: 'local-action',
    primaryObserveSurface: 'vw-detail',
    flow: [
      'Read browser-CDP availability',
      'Report available or degraded note',
    ],
    observe: [
      'Unavailable is acceptable and should not fail the shell',
    ],
    expected: [
      'Optional embodied surface is explicitly visible',
    ],
  },
  {
    id: 'browser-cdp-smoke',
    family: 'browser-cdp',
    label: 'Smoke',
    badge: 'CDP',
    summary: 'Run the CDP smoke path with navigate, text read, and screenshot capture.',
    prerequisites: [
      'Chrome/CDP may be present, but absence is still a valid outcome',
    ],
    targets: ['dashboard', 'browser-cdp'],
    injectKind: 'local-action',
    primaryObserveSurface: 'vw-detail',
    flow: [
      'Navigate to data URL smoke page',
      'Read #status text',
      'Capture screenshot bytes',
    ],
    observe: [
      'Available path should return navigate/text/screenshot lines',
      'Unavailable path should return a degraded-mode note',
    ],
    expected: [
      'CDP is optional, not required for simulator health',
    ],
  },
  {
    id: 'browser-cdp-stop',
    family: 'browser-cdp',
    label: 'Stop',
    badge: 'CDP',
    summary: 'Emit a browser-cdp-stop quick-pass signal on the dashboard browser scope.',
    prerequisites: [
      'Browser runtime may or may not be attached',
    ],
    targets: ['dashboard', 'browser-cdp'],
    injectKind: 'signal-sequence',
    primaryObserveSurface: 'control-signals',
    flow: [
      'Emit browser-cdp-stop quick-pass',
      'Let browser runtime consume it if active',
    ],
    observe: [
      'Control signal timeline should show browser-cdp-stop',
    ],
    expected: [
      'Embodied browser surface remains quick-pass capable',
    ],
  },
];

export function listSimulationScenarios(): readonly SimulationScenario[] {
  return SIMULATION_SCENARIOS;
}
