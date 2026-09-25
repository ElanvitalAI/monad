export type DashboardDeltaBrowserMode = 'all' | 'files' | 'turns';
export type DashboardDeltaBrowseScope = 'latest' | 'recent';

export type DashboardChatMainDeltaCommand =
  | { kind: 'help' }
  | { kind: 'open'; scope: DashboardDeltaBrowseScope; limit?: number; browserMode?: DashboardDeltaBrowserMode }
  | { kind: 'unknown'; subcommand: string };

export function parseDashboardDeltaBrowserMode(
  raw: string | undefined,
): DashboardDeltaBrowserMode | undefined {
  switch ((raw ?? '').toLowerCase()) {
    case 'all':
    case 'files':
    case 'turns':
      return raw!.toLowerCase() as DashboardDeltaBrowserMode;
    default:
      return undefined;
  }
}

export function dashboardDeltaHelpLines(defaultHistory: number, defaultMode: string): string[] {
  return [
    '\u276f /delta',
    'Usage:',
    '  /delta open [mode]       Open the recent source-delta review popup.',
    '  /delta latest [mode]     Open only the latest source-delta turn.',
    '  /delta recent [n] [mode] Open up to N recent source-delta turns.',
    '  /delta files             Open recent source deltas as a flat file list.',
    '  /delta turns             Open recent source deltas as turn summaries only.',
    '  /delta help              Show this help.',
    '',
    'Notes:',
    '  Includes the current in-flight turn when edits already happened.',
    `  Default recent depth comes from chat.rendering.diff.turnBrowserHistory (${defaultHistory}).`,
    `  Default browser mode comes from chat.rendering.diff.turnBrowserMode (${defaultMode}).`,
  ];
}

export function resolveDashboardChatMainDeltaCommand(
  args: string[],
): DashboardChatMainDeltaCommand {
  const sub = (args[0] ?? 'open').toLowerCase();
  if (sub === 'help') return { kind: 'help' };
  if (sub === 'latest' || sub === 'last') {
    return {
      kind: 'open',
      scope: 'latest',
      browserMode: parseDashboardDeltaBrowserMode(args[1]),
    };
  }
  if (sub === 'recent') {
    const rawLimit = Number.parseInt(args[1] ?? '', 10);
    const limit = Number.isFinite(rawLimit) ? rawLimit : undefined;
    return {
      kind: 'open',
      scope: 'recent',
      limit,
      browserMode: parseDashboardDeltaBrowserMode(Number.isFinite(rawLimit) ? args[2] : args[1]),
    };
  }
  if (sub === 'files' || sub === 'turns' || sub === 'all') {
    return {
      kind: 'open',
      scope: 'recent',
      browserMode: sub as DashboardDeltaBrowserMode,
    };
  }
  if (sub === 'open' || sub === 'show') {
    return {
      kind: 'open',
      scope: 'recent',
      browserMode: parseDashboardDeltaBrowserMode(args[1]),
    };
  }
  return { kind: 'unknown', subcommand: sub };
}
