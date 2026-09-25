import { describe, expect, test } from 'bun:test';

import { createDashboardBenchSlashRuntime } from '../src/dashboard/bench-slash-runtime.js';

describe('createDashboardBenchSlashRuntime', () => {
  test('builds help, validation, and result lines', () => {
    const runtime = createDashboardBenchSlashRuntime({
      accent: (text) => `accent:${text}`,
      muted: (text) => `muted:${text}`,
      warning: (text) => `warning:${text}`,
      error: (text) => `error:${text}`,
      maxPanes: 4,
    });

    const help = runtime.helpLines();
    expect(help[1]).toBe('accent:❯ /bench');
    expect(help.some((line) => line.includes('Up to 4 providers'))).toBe(true);
    expect(runtime.missingSeparatorLine()).toBe('warning:  /bench missing "::" separator. Try /bench help.');
    expect(runtime.emptyPromptLine()).toBe('warning:  /bench: prompt is empty.');
    expect(runtime.noProvidersLine()).toBe('warning:  /bench: no providers parsed.');
    expect(runtime.tooManyProvidersLine()).toBe('warning:  /bench: max 4 providers — trim the list.');
    expect(runtime.spawnedLine(7, 3, ['grok', 'openai', 'anthropic'])).toBe(
      'muted:  bench win:7 — 3 panes: grok, openai, anthropic',
    );
    expect(runtime.failedLine('boom')).toBe('error:  /bench failed: boom');
  });
});
