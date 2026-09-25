export type DashboardChatMainCacheCommand =
  | { kind: 'reset' }
  | { kind: 'show' };

export function resolveDashboardChatMainCacheCommand(
  args: string[],
): DashboardChatMainCacheCommand {
  const sub = (args[0] ?? '').toLowerCase();
  if (sub === 'reset') return { kind: 'reset' };
  return { kind: 'show' };
}
