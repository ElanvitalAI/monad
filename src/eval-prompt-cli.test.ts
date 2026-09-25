import { describe, expect, test } from 'bun:test';
import { buildEvalPromptToolSurface, isEvalPromptToolSurface, runEvalPrompt } from './eval-prompt-cli.js';
import type { UserConfig } from './user-config.js';

const cfg = {
  chat: { toolDeny: [] },
  finance: { enabled: false },
} as unknown as UserConfig;

describe('eval prompt CLI preservation', () => {
  test('tool surfaces remain constructible while runEvalPrompt keeps its cwd option on the exported contract', () => {
    expect(isEvalPromptToolSurface('cli')).toBe(true);
    expect(buildEvalPromptToolSurface('cli', 'claude', cfg).specs.map((tool) => tool.name)).toContain('Bash');
    type CwdOption = Parameters<typeof runEvalPrompt>[0]['cwd'];
    const cwd: CwdOption = '/tmp/eval-prompt-cwd-contract';
    expect(cwd).toBe('/tmp/eval-prompt-cwd-contract');
  });
});
