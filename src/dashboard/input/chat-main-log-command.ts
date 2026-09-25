export type DashboardChatMainLogCommand =
  | { kind: 'help' }
  | { kind: 'size'; delta: string }
  | { kind: 'clear' }
  | { kind: 'filter'; query: string }
  | { kind: 'search'; query: string }
  | { kind: 'freeze' }
  | { kind: 'solo' }
  | { kind: 'turn'; arg: string }
  | { kind: 'fold'; mode: string }
  | { kind: 'copy-all' }
  | { kind: 'return-to-input' }
  | { kind: 'unknown'; subcommand: string };

export function resolveDashboardChatMainLogCommand(
  args: string[],
): DashboardChatMainLogCommand {
  const sub = (args[0] ?? '').toLowerCase();
  if (!sub || sub === 'help') return { kind: 'help' };
  if (sub === 'size') return { kind: 'size', delta: (args[1] ?? '').trim() };
  if (sub === 'clear') return { kind: 'clear' };
  if (sub === 'filter') return { kind: 'filter', query: args.slice(1).join(' ').trim() };
  if (sub === 'search') return { kind: 'search', query: args.slice(1).join(' ').trim() };
  if (sub === 'freeze') return { kind: 'freeze' };
  if (sub === 'solo' || sub === 'maximize' || sub === 'zoom') return { kind: 'solo' };
  if (sub === 'turn') return { kind: 'turn', arg: (args[1] ?? '').toLowerCase().trim() };
  if (sub === 'fold') return { kind: 'fold', mode: (args[1] ?? '').toLowerCase().trim() };
  if (sub === 'copy' || sub === 'all') return { kind: 'copy-all' };
  if (sub === 'input' || sub === 'return') return { kind: 'return-to-input' };
  return { kind: 'unknown', subcommand: sub };
}
