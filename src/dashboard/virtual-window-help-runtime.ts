import type { NavCallbacks } from '../virtual-windows/navigation.js';

type VwHelpCallbacks = Pick<NavCallbacks, 'onHelp'>;

export interface DashboardVirtualWindowHelpRegistrationState {
  supplementalGlobalKeys: boolean;
  virtualWindowSwitchKeys: boolean;
}

interface DashboardVirtualWindowHelpLineDeps {
  keyLabel: (key: string, desc: string) => string;
  sectionLabel: (title: string) => string;
  muted: (text: string) => string;
}

export interface DashboardVirtualWindowHelpRuntimeDeps extends DashboardVirtualWindowHelpLineDeps {
  termSize: () => { cols: number; rows: number };
  registrationState: DashboardVirtualWindowHelpRegistrationState;
  showHelpModal: (spec: {
    title: string;
    lines: string[];
    termCols: number;
    termRows: number;
    ttlMs: number;
    group: string;
  }) => void;
}

export function buildDashboardVirtualWindowHelpLines(
  deps: DashboardVirtualWindowHelpLineDeps,
  registrationState: DashboardVirtualWindowHelpRegistrationState,
): string[] {
  const key = deps.keyLabel;
  const section = deps.sectionLabel;
  const switchLines = registrationState.virtualWindowSwitchKeys
    ? [
      key('1..9', 'Switch to Nth window (Ctrl+1..9 also works)'),
      key('n / .  / >', 'Next window'),
      key('p / , / <', 'Previous window'),
    ]
    : [deps.muted('    Enable dashboard.enableVirtualWindowSwitchKeys for 1..9 and next/previous window switching.')];
  const pickerLines = registrationState.supplementalGlobalKeys
    ? [key('0', 'Open window picker')]
    : [
      key('Alt+0', 'Open window picker'),
      deps.muted('    Enable dashboard.enableSupplementalGlobalKeys for Ctrl+B 0 window picker access.'),
    ];
  const supplementalLifecycleLines = registrationState.supplementalGlobalKeys
    ? [key('X', 'Close whole window')]
    : [deps.muted('    Enable dashboard.enableSupplementalGlobalKeys to close a whole window and jump to the last focused pane.')];
  const supplementalMiscLines = registrationState.supplementalGlobalKeys
    ? [key('Tab', 'Jump to last focused pane (alt-tab)')]
    : [];

  return [
    section('Mode switch (from chat input)'),
    key('s', '→ sync mode'),
    key('c', '→ control mode'),
    key('g', '→ general mode (exit sync/control)'),
    deps.muted('    Input-focus only — in pane-browse the letters below apply.'),
    '',
    section('Window switch'),
    ...pickerLines,
    ...switchLines,
    '',
    section('Window lifecycle'),
    key('c', 'New virtual window (terminal)'),
    key('t', 'Toggle modal ↔ virtual-window session'),
    key('x', 'Close focused pane'),
    ...supplementalLifecycleLines,
    '',
    section('Split + focus'),
    key('"  / v', 'Vertical split'),
    key('%  / s', 'Horizontal split'),
    key('↑ / k', 'Focus pane above'),
    key('↓ / j', 'Focus pane below'),
    key('← / h', 'Focus pane left'),
    key('→ / l', 'Focus pane right'),
    '',
    section('Misc'),
    key('i', 'Toggle sync-input bar on foreground window'),
    key('z', 'Zoom focused pane (fullscreen within VW, toggle)'),
    ...supplementalMiscLines,
    key('R', 'Rename foreground window (^B , in tmux; here ^B R)'),
    key('A', 'Rename focused pane (VW-local override)'),
    key('?', 'Show this popup (dismisses after 8 s)'),
    '',
    deps.muted('Chord prefix: Ctrl+B or Ctrl+ㅠ — 1 s window'),
    ...(registrationState.virtualWindowSwitchKeys
      ? [deps.muted('Global fast-switch: Alt+N/P/1..9/0 (no chord needed)')]
      : []),
    deps.muted('See docs/archive/2026-04/KEYBINDINGS.md §14 for full reference'),
  ];
}

export function createDashboardVirtualWindowHelpRuntime(
  deps: DashboardVirtualWindowHelpRuntimeDeps,
): VwHelpCallbacks {
  return {
    onHelp: () => {
      const { cols: tc, rows: tr } = deps.termSize();
      const lines = buildDashboardVirtualWindowHelpLines(deps, deps.registrationState);
      deps.showHelpModal({
        title: 'Virtual-window chord — ^B <key>',
        lines,
        termCols: tc,
        termRows: tr,
        ttlMs: 8000,
        group: 'vw-chord-help',
      });
    },
  };
}
