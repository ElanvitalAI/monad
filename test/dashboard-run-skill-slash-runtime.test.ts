import { describe, expect, test } from 'bun:test';

import { createDashboardRunSkillSlashRuntime } from '../src/dashboard/run-skill-slash-runtime.js';

describe('createDashboardRunSkillSlashRuntime', () => {
  test('builds run-skill help lines', () => {
    const runtime = createDashboardRunSkillSlashRuntime({
      accent: (text) => `accent:${text}`,
      muted: (text) => `muted:${text}`,
      text: (text) => `text:${text}`,
      subtext: (text) => `sub:${text}`,
    });

    const lines = runtime.helpLines(['skill a', 'skill b'], 2);
    expect(lines[1]).toBe('accent:❯ /run-skill');
    expect(lines[2]).toBe('muted:Usage: /run-skill <skill-name> [arguments...]');
    expect(lines[4]).toBe('text:Available skills (2):');
    expect(lines[5]).toBe('  sub:skill a');
  });

  test('adds overflow line for long skill lists', () => {
    const runtime = createDashboardRunSkillSlashRuntime({
      accent: (text) => text,
      muted: (text) => `muted:${text}`,
      text: (text) => text,
      subtext: (text) => text,
    });
    const lines = runtime.helpLines(Array.from({ length: 35 }, (_, i) => `skill-${i}`), 35);
    expect(lines.at(-1)).toBe('muted:  ... and 5 more');
  });
});
