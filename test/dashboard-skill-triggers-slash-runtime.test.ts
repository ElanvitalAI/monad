import { describe, expect, test } from 'bun:test';

import { createDashboardSkillTriggersSlashRuntime } from '../src/dashboard/skill-triggers-slash-runtime.js';

describe('createDashboardSkillTriggersSlashRuntime', () => {
  test('builds usage, summary, missing, and detail lines', () => {
    const runtime = createDashboardSkillTriggersSlashRuntime({
      accent: (text) => `accent:${text}`,
      muted: (text) => `muted:${text}`,
      error: (text) => `error:${text}`,
    });

    const usage = runtime.usageLines();
    expect(usage[1]).toBe('accent:❯ /skill-triggers');
    expect(usage[2]).toContain('Usage: /skill-triggers');

    const summary = runtime.summaryLines([
      { name: 'skill-a', explicitCount: 2, extractedCount: 3, triggerSource: 'both' },
    ]);
    expect(summary[0]).toBe('accent:❯ /skill-triggers *');
    expect(summary[1]).toContain('skill-a');
    expect(summary[1]).toContain('both');

    expect(runtime.missingSkillLine('foo')).toBe('error:Skill not found: foo');

    const detail = runtime.detailLines({
      name: 'skill-a',
      triggerSource: 'both',
      triggers: ['a', 'b'],
      extractedTriggers: ['x', 'y'],
      autoTrigger: true,
    });
    expect(detail[0]).toBe('accent:❯ /skill-triggers skill-a');
    expect(detail[1]).toBe('muted:  source: both');
    expect(detail[2]).toContain('explicit (2): a, b');
    expect(detail[3]).toContain('extracted (2): x, y');
    expect(detail[4]).toBe('muted:  autoTrigger: true');
  });
});
