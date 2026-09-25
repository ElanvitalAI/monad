import { describe, expect, test } from 'bun:test';

import {
  applyDashboardActionBlock,
  parseDashboardActionBlock,
} from '../src/dashboard/action-block-runtime.js';

describe('parseDashboardActionBlock', () => {
  test('extracts action json blocks and returns null otherwise', () => {
    expect(parseDashboardActionBlock('hello')).toBeNull();
    expect(parseDashboardActionBlock('```action\n{"run":"sync"}\n```')).toEqual({ run: 'sync' });
  });
});

describe('applyDashboardActionBlock', () => {
  test('applies selections, mode changes, and sync auto-run eligibility', () => {
    const sync = {
      allSkillNames: ['a', 'b'],
      selected: [new Set<string>(), new Set<string>(), new Set<string>()] as [Set<string>, Set<string>, Set<string>],
      modeIdx: 0,
    };

    const outcome = applyDashboardActionBlock({
      select: {
        skills: ['*'],
        servers: ['s1'],
        services: ['svc1'],
      },
      mode: 'diff',
      run: 'sync',
    }, sync);

    expect([...sync.selected[0]]).toEqual(['a', 'b']);
    expect([...sync.selected[1]]).toEqual(['s1']);
    expect([...sync.selected[2]]).toEqual(['svc1']);
    expect(outcome.applied).toContain('2 skills');
    expect(outcome.applied).toContain('1 servers');
    expect(outcome.applied).toContain('1 services');
    expect(outcome.applied.some((entry) => entry.startsWith('mode:'))).toBe(true);
    expect(outcome.autoRun).toBe('sync');
  });

  test('does not auto-run when required selections are incomplete', () => {
    const sync = {
      allSkillNames: ['a'],
      selected: [new Set<string>(), new Set<string>(), new Set<string>()] as [Set<string>, Set<string>, Set<string>],
      modeIdx: 0,
    };

    const outcome = applyDashboardActionBlock({
      select: {
        skills: ['a'],
      },
      run: 'diff',
    }, sync);

    expect(outcome.autoRun).toBeNull();
  });
});
