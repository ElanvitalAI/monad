export interface DashboardSkillTriggerSummaryEntry {
  name: string;
  explicitCount: number;
  extractedCount: number;
  triggerSource: string;
}

export interface DashboardSkillTriggerDetailEntry {
  name: string;
  triggerSource: string;
  triggers: readonly string[];
  extractedTriggers: readonly string[];
  autoTrigger: boolean;
}

export interface DashboardSkillTriggersSlashRuntimeDeps {
  accent: (text: string) => string;
  muted: (text: string) => string;
  error: (text: string) => string;
}

export interface DashboardSkillTriggersSlashRuntime {
  usageLines(): string[];
  summaryLines(entries: readonly DashboardSkillTriggerSummaryEntry[]): string[];
  missingSkillLine(target: string): string;
  detailLines(entry: DashboardSkillTriggerDetailEntry): string[];
}

export function createDashboardSkillTriggersSlashRuntime(
  deps: DashboardSkillTriggersSlashRuntimeDeps,
): DashboardSkillTriggersSlashRuntime {
  return {
    usageLines: () => [
      '',
      deps.accent('\u276f /skill-triggers'),
      deps.muted('Usage: /skill-triggers <skill-name>   |   /skill-triggers *  (summary)'),
    ],
    summaryLines: (entries) => {
      const lines = [deps.accent('\u276f /skill-triggers *')];
      for (const entry of entries) {
        lines.push(
          deps.muted(
            `  ${entry.name.padEnd(36)} ${String(entry.explicitCount).padStart(3)} explicit · ${String(entry.extractedCount).padStart(3)} extracted · ${entry.triggerSource}`,
          ),
        );
      }
      return lines;
    },
    missingSkillLine: (target) => deps.error(`Skill not found: ${target}`),
    detailLines: (entry) => {
      const extractedPreview = entry.extractedTriggers.slice(0, 20).join(', ') || '(none)';
      const extractedOverflow = entry.extractedTriggers.length > 20
        ? ` … +${entry.extractedTriggers.length - 20}`
        : '';
      return [
        deps.accent(`\u276f /skill-triggers ${entry.name}`),
        deps.muted(`  source: ${entry.triggerSource}`),
        deps.muted(`  explicit (${entry.triggers.length}): ${entry.triggers.join(', ') || '(none)'}`),
        deps.muted(`  extracted (${entry.extractedTriggers.length}): ${extractedPreview}${extractedOverflow}`),
        deps.muted(`  autoTrigger: ${entry.autoTrigger}`),
      ];
    },
  };
}
