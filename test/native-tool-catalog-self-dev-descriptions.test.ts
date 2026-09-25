import { describe, expect, test } from 'bun:test';

import { nativeToolCatalog } from '../src/native-tool-catalog.js';

describe('self-development catalog descriptions', () => {
  test('select single and harnessed small coding work without requiring a PR', () => {
    const selfImplement = nativeToolCatalog.find(e => e.id === 'self_implement');
    const devHarness = nativeToolCatalog.find(e => e.id === 'run_dev_harness');

    expect(selfImplement).toMatchObject({
      shouldDefer: false,
    });
    expect(devHarness).toMatchObject({
      shouldDefer: true,
    });

    for (const tool of [selfImplement, devHarness]) {
      expect(tool).toBeDefined();
      expect(tool!.description).toContain('small coding task');
      expect(tool!.description).toContain('PR request is NOT required');
      expect(tool!.description).toContain('DRAFT pull request');
      expect(tool!.description).toContain('fail-closed human gate');
      expect(tool!.description).toContain('Long-running (minutes).');
    }
    expect(selfImplement!.description).toContain('"이 작은 수정 해줘"');
    expect(devHarness!.description).toContain('"하니스로 이 버그 고쳐줘"');
    expect(devHarness!.description).toContain('Planner → Executor → Reviewer → Deployer');
  });
});
