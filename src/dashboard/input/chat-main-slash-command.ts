export interface DashboardChatMainSlashCommand {
  cmdLower: string;
  args: string[];
}

export function resolveDashboardChatMainSlashCommand(
  commandText: string,
): DashboardChatMainSlashCommand {
  const [cmd, ...rawArgs] = commandText.slice(1).split(/\s+/);
  let cmdLower = cmd?.toLowerCase() ?? '';
  let args: string[] = rawArgs;

  // Top-level alias: `/resume <id>` → `/session load <id>`.
  // Reuses the existing /session subcommand handler so the resume
  // flow stays in one place.
  if (cmdLower === 'resume') {
    cmdLower = 'session';
    args = ['load', ...rawArgs];
  }

  return {
    cmdLower,
    args,
  };
}
