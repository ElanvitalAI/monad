export interface DashboardRunSkillSlashRuntimeDeps {
  accent: (text: string) => string;
  muted: (text: string) => string;
  text: (text: string) => string;
  subtext: (text: string) => string;
}

export interface DashboardRunSkillSlashRuntime {
  helpLines(skillDescriptions: readonly string[], totalCount: number): string[];
}

export function createDashboardRunSkillSlashRuntime(
  deps: DashboardRunSkillSlashRuntimeDeps,
): DashboardRunSkillSlashRuntime {
  return {
    helpLines: (skillDescriptions, totalCount) => {
      const lines = [
        '',
        deps.accent('\u276f /run-skill'),
        deps.muted('Usage: /run-skill <skill-name> [arguments...]'),
        '',
        deps.text(`Available skills (${totalCount}):`),
      ];
      for (const line of skillDescriptions.slice(0, 30)) {
        lines.push(`  ${deps.subtext(line)}`);
      }
      if (totalCount > 30) {
        lines.push(deps.muted(`  ... and ${totalCount - 30} more`));
      }
      return lines;
    },
  };
}
