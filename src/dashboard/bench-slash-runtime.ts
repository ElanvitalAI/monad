export interface DashboardBenchSlashRuntimeDeps {
  accent: (text: string) => string;
  muted: (text: string) => string;
  warning: (text: string) => string;
  error: (text: string) => string;
  maxPanes: number;
}

export interface DashboardBenchSlashRuntime {
  helpLines(): string[];
  missingSeparatorLine(): string;
  emptyPromptLine(): string;
  noProvidersLine(): string;
  tooManyProvidersLine(): string;
  spawnedLine(windowId: number, paneCount: number, providerNames: readonly string[]): string;
  failedLine(message: string): string;
}

export function createDashboardBenchSlashRuntime(
  deps: DashboardBenchSlashRuntimeDeps,
): DashboardBenchSlashRuntime {
  return {
    helpLines: () => [
      '',
      deps.accent('\u276f /bench'),
      deps.muted('Usage:'),
      deps.muted('  /bench <prompt> :: <provider>[:<model>],<provider>[:<model>][,...]'),
      deps.muted(`  Up to ${deps.maxPanes} providers. Layout auto-picks columns (≤2) or grid (3-4).`),
      deps.muted('  Example: /bench Explain quantum in 1 line :: grok,openai:gpt-4o,anthropic'),
    ],
    missingSeparatorLine: () => deps.warning('  /bench missing "::" separator. Try /bench help.'),
    emptyPromptLine: () => deps.warning('  /bench: prompt is empty.'),
    noProvidersLine: () => deps.warning('  /bench: no providers parsed.'),
    tooManyProvidersLine: () => deps.warning(`  /bench: max ${deps.maxPanes} providers — trim the list.`),
    spawnedLine: (windowId, paneCount, providerNames) => (
      deps.muted(`  bench win:${windowId} — ${paneCount} panes: ${providerNames.join(', ')}`)
    ),
    failedLine: (message) => deps.error(`  /bench failed: ${message}`),
  };
}
