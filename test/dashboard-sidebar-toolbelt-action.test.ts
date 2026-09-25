import { describe, expect, test } from 'bun:test';

import { formatDashboardSidebarToolbeltAction } from '../src/dashboard/sidebar-toolbelt-action.js';

describe('formatDashboardSidebarToolbeltAction', () => {
  test('formats status lines with and without a tracked record', () => {
    const missing = formatDashboardSidebarToolbeltAction('status', 's1', {
      getStatusRecord: () => null,
      attachBlock: () => ({ kind: 'no-block' }),
    });
    expect(missing).toEqual({
      tone: 'muted',
      message: '[toolbelt] s1: no status tracked yet.',
    });

    const present = formatDashboardSidebarToolbeltAction('status', 's2', {
      getStatusRecord: () => ({
        status: 'running',
        updatedAt: Date.parse('2026-04-30T10:20:30Z'),
        lastEvent: 'step',
      }),
      attachBlock: () => ({ kind: 'no-block' }),
    });
    expect(present.tone).toBe('info');
    expect(present.message).toContain('[toolbelt] s2 status=running @ 2026-04-30 10:20:30 · step');
  });

  test('formats attach, review, and unknown actions', () => {
    const attached = formatDashboardSidebarToolbeltAction('attach', 's3', {
      getStatusRecord: () => null,
      attachBlock: () => ({
        kind: 'attached',
        attachmentId: 'block-7',
        lines: 12,
        bytes: 2048,
        total: 2,
      }),
    });
    expect(attached).toEqual({
      tone: 'info',
      message: '[toolbelt] 📎 attached block-7 from s3 (12 lines, 2.0KB) [queue 2] — next chat send will include this as context.',
    });

    const review = formatDashboardSidebarToolbeltAction('review', 's3', {
      getStatusRecord: () => null,
      attachBlock: () => ({ kind: 'no-block' }),
    });
    expect(review).toEqual({
      tone: 'muted',
      message: '[toolbelt] review — coming soon (future session).',
    });

    const unknown = formatDashboardSidebarToolbeltAction('mystery', 's3', {
      getStatusRecord: () => null,
      attachBlock: () => ({ kind: 'no-block' }),
    });
    expect(unknown).toEqual({
      tone: 'muted',
      message: '[toolbelt] unknown action: mystery',
    });
  });
});
