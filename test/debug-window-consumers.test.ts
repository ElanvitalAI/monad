import { describe, expect, test } from 'bun:test';

import {
  buildDebugWorkbenchColumns,
  debugWorkbenchIndexForTarget,
  getDebugCompanionSpec,
  listDebugCompanionKeys,
  resolveDebugCompanionTargets,
} from '../src/window/debug-window-consumers.js';

describe('debug-window-consumers', () => {
  test('builds a stable 2x2 debug workbench column set', () => {
    expect(buildDebugWorkbenchColumns()).toEqual([
      { title: 'events', widgetInstanceId: 'wd-debug-events', weight: 3 },
      { title: 'detail', widgetInstanceId: 'wd-debug-detail', weight: 4 },
      { title: 'activity', widgetInstanceId: 'wd-debug-stack', weight: 3 },
      { title: 'prompts', widgetInstanceId: 'wd-debug-prompts', weight: 4 },
    ]);
  });

  test('resolves debug companion aliases and all-target expansion', () => {
    expect(resolveDebugCompanionTargets('events')).toEqual(['debug-events']);
    expect(resolveDebugCompanionTargets('inspector')).toEqual(['debug-detail']);
    expect(resolveDebugCompanionTargets('activity')).toEqual(['debug-stack']);
    expect(resolveDebugCompanionTargets('bank')).toEqual(['debug-prompts']);
    expect(resolveDebugCompanionTargets('all')).toEqual(listDebugCompanionKeys());
    expect(resolveDebugCompanionTargets('unknown')).toEqual([]);
  });

  test('exposes companion metadata for live monitor surfaces', () => {
    expect(getDebugCompanionSpec('debug-stack')).toEqual({
      key: 'debug-stack',
      widgetInstanceId: 'wd-debug-stack',
      title: 'Agent Activity',
      status: 'companion · agent activity monitor',
    });
  });

  test('maps debug targets onto stable workbench cell indexes', () => {
    expect(debugWorkbenchIndexForTarget('debug-events')).toBe(0);
    expect(debugWorkbenchIndexForTarget('debug-detail')).toBe(1);
    expect(debugWorkbenchIndexForTarget('debug-stack')).toBe(2);
    expect(debugWorkbenchIndexForTarget('debug-prompts')).toBe(3);
  });
});
