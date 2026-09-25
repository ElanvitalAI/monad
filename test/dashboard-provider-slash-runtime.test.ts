import { describe, expect, test } from 'bun:test';

import { createDashboardProviderSlashRuntime } from '../src/dashboard/provider-slash-runtime.js';

describe('createDashboardProviderSlashRuntime', () => {
  test('builds provider slash lines', () => {
    const runtime = createDashboardProviderSlashRuntime({
      accent: (text) => `accent:${text}`,
      muted: (text) => `muted:${text}`,
      success: (text) => `success:${text}`,
      warning: (text) => `warning:${text}`,
      text: (text) => `text:${text}`,
      subtext: (text) => `sub:${text}`,
    });

    expect(runtime.rotationEmptyLine()).toContain('rotation empty');
    expect(runtime.rotatedLine('fast', 'openai', 'gpt-5')).toBe('success:  ✓ rotated → fast  (openai / gpt-5)');
    expect(runtime.useUsageLine()).toBe('warning:  usage: /provider use <label | provider | model-substring>');
    expect(runtime.noRotationMatchLine('abc')).toBe('warning:  no rotation entry matching "abc"');
    expect(runtime.switchedLine('fast', 'openai', 'gpt-5')).toBe('success:  ✓ switched → fast  (openai / gpt-5)');
    expect(runtime.resetEmptyLine()).toBe('warning:  rotation empty — nothing to reset');
    expect(runtime.resetLine('fast')).toBe('success:  ✓ reset → fast');

    const lines = runtime.overviewLines(
      [{ label: 'fast', provider: 'openai', model: 'gpt-5', current: true }],
      [{ available: true, name: 'openai', model: 'gpt-5' }],
    );
    expect(lines[1]).toBe('accent:❯ /provider');
    expect(lines.some((line) => line.includes('Rotation (cycle with'))).toBe(true);
    expect(lines.some((line) => line.includes('Available providers'))).toBe(true);
  });
});
