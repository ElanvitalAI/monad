export function terminalTreeNames(workdir?: string): { treeName: string; worktreeName: string } {
  const parts = workdir?.split('/').filter(Boolean) ?? [];
  const sourceIndex = parts.indexOf('source');
  const worktreesIndex = parts.indexOf('monad-agent.worktrees');
  const sourceTreeName = sourceIndex >= 0 ? parts[sourceIndex + 1] : undefined;
  const harnessTreeName = parts[worktreesIndex - 3] === '.monad' && parts[worktreesIndex - 2] === 'worktrees'
    ? parts[worktreesIndex - 1]
    : undefined;
  return {
    treeName: sourceTreeName || harnessTreeName || '',
    worktreeName: worktreesIndex >= 0 && parts[worktreesIndex + 1] ? parts[worktreesIndex + 1]! : '',
  };
}

export function terminalTreeLabel(workdir?: string): string {
  const { treeName, worktreeName } = terminalTreeNames(workdir);
  return [treeName, worktreeName].filter(Boolean).join('/');
}
