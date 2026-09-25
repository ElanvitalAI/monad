'use client';

import { useDaemon } from '@/components/providers/DaemonProvider';

const PROVIDERS = ['', 'claude', 'gemini', 'grok', 'codex'];

export function ProviderPicker() {
  const { config, setConfig } = useDaemon();

  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>provider</span>
      <select
        value={config.provider}
        onChange={(e) => setConfig({ provider: e.target.value })}
        className="rounded-md border border-input bg-background px-2 py-1 text-xs"
      >
        {PROVIDERS.map((p) => (
          <option key={p} value={p}>
            {p || '(default)'}
          </option>
        ))}
      </select>
    </label>
  );
}
