export type DashboardChatMainThemeCommand =
  | { kind: 'list' }
  | { kind: 'switch'; name?: string }
  | { kind: 'use'; id?: string }
  | { kind: 'reset' }
  | { kind: 'preview'; mode: 'preview' | 'export' }
  | { kind: 'unknown'; subcommand: string };

export function resolveDashboardChatMainThemeCommand(
  args: string[],
): DashboardChatMainThemeCommand {
  const sub = (args[0] || 'preview').toLowerCase();
  if (sub === 'list') return { kind: 'list' };
  if (sub === 'switch') return { kind: 'switch', name: args[1] };
  if (sub === 'use') return { kind: 'use', id: args[1] };
  if (sub === 'reset') return { kind: 'reset' };
  if (sub === 'preview' || sub === 'export') return { kind: 'preview', mode: sub };
  return { kind: 'unknown', subcommand: sub };
}
