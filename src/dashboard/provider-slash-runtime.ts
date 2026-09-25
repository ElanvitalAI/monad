export interface DashboardProviderRotationEntryView {
  label: string;
  provider: string;
  model: string;
  current: boolean;
}

export interface DashboardProviderAvailabilityView {
  available: boolean;
  name: string;
  model: string;
}

export interface DashboardProviderSlashRuntimeDeps {
  accent: (text: string) => string;
  muted: (text: string) => string;
  success: (text: string) => string;
  warning: (text: string) => string;
  text: (text: string) => string;
  subtext: (text: string) => string;
}

export interface DashboardProviderSlashRuntime {
  rotationEmptyLine(): string;
  rotatedLine(label: string, provider: string, model?: string | null): string;
  useUsageLine(): string;
  noRotationMatchLine(needle: string): string;
  switchedLine(label: string, provider: string, model?: string | null): string;
  resetEmptyLine(): string;
  resetLine(label: string): string;
  overviewLines(
    rotationEntries: readonly DashboardProviderRotationEntryView[],
    providers: readonly DashboardProviderAvailabilityView[],
  ): string[];
}

export function createDashboardProviderSlashRuntime(
  deps: DashboardProviderSlashRuntimeDeps,
): DashboardProviderSlashRuntime {
  const providerDetail = (provider: string, model?: string | null): string =>
    `${provider}${model ? ` / ${model}` : ''}`;

  return {
    rotationEmptyLine: () => deps.warning('  rotation empty — add entries first via `monad provider:rotate add <provider>`'),
    rotatedLine: (label, provider, model) => deps.success(`  ✓ rotated → ${label}  (${providerDetail(provider, model)})`),
    useUsageLine: () => deps.warning('  usage: /provider use <label | provider | model-substring>'),
    noRotationMatchLine: (needle) => deps.warning(`  no rotation entry matching "${needle}"`),
    switchedLine: (label, provider, model) => deps.success(`  ✓ switched → ${label}  (${providerDetail(provider, model)})`),
    resetEmptyLine: () => deps.warning('  rotation empty — nothing to reset'),
    resetLine: (label) => deps.success(`  ✓ reset → ${label}`),
    overviewLines: (rotationEntries, providers) => {
      const lines = ['', deps.accent('\u276f /provider')];
      if (rotationEntries.length > 0) {
        lines.push(deps.muted('  Rotation (cycle with `/provider next` or `/provider use <label>`):'));
        for (const entry of rotationEntries) {
          const marker = entry.current ? deps.success('▸') : ' ';
          lines.push(`  ${marker} ${entry.label.padEnd(14)} ${deps.subtext(entry.provider)}  ${deps.muted(entry.model)}`);
        }
        lines.push('');
      }
      lines.push(deps.muted('  Available providers (env-detected):'));
      for (const provider of providers) {
        const mark = provider.available ? deps.success('\u2713') : deps.muted('\u00B7');
        const label = provider.available ? deps.text(provider.name) : deps.muted(provider.name);
        const hint = !provider.available
          ? deps.muted(`  (set ${provider.name.toUpperCase()}_API_KEY${provider.name === 'local' ? ' or LOCAL_LLM_URL' : ''})`)
          : '';
        lines.push(`  ${mark} ${label.padEnd(20)} ${deps.subtext(provider.model)}${hint}`);
      }
      return lines;
    },
  };
}
