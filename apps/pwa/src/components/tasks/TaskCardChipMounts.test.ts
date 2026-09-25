// W9d-FU Z13-a + Z13-c · TaskCard chip mount grep.
//
// `feedback_source_level_grep_test_value` pattern — keeps the wire's
// concrete tokens frozen so a future refactor cannot silently drop the
// NextFluentChip / IdleNudgeBadge mounts.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PANEL = readFileSync(
  resolve(HERE, 'TaskManagerPanel.tsx'),
  'utf8',
);

describe('TaskManagerPanel · imports', () => {
  test('NextFluentChip imported from fluent-chain', () => {
    expect(PANEL).toContain(`from '@/components/fluent-chain/NextFluentChip'`);
    expect(PANEL).toMatch(/import\s*\{\s*NextFluentChip\s*\}/);
  });
  test('IdleNudgeBadge imported from idle-nudge', () => {
    expect(PANEL).toContain(`from '@/components/idle-nudge/IdleNudgeBadge'`);
    expect(PANEL).toMatch(/import\s*\{\s*IdleNudgeBadge\s*\}/);
  });
});

describe('TaskManagerPanel · status sets', () => {
  test('IDLE_NUDGE_STATUSES carries ready/running/review/blocked', () => {
    expect(PANEL).toMatch(/IDLE_NUDGE_STATUSES[\s\S]*?'ready'[\s\S]*?'running'[\s\S]*?'review'[\s\S]*?'blocked'/);
  });
  test('DONE_STATUSES carries done/failed', () => {
    expect(PANEL).toMatch(/DONE_STATUSES[\s\S]*?'done'[\s\S]*?'failed'/);
  });
});

describe('TaskManagerPanel · TaskStatusChips component', () => {
  test('component exists + renders nothing when status is outside the two sets', () => {
    expect(PANEL).toMatch(/function TaskStatusChips/);
    expect(PANEL).toMatch(/if \(!isDone && !isIdle\) return null/);
  });
  test('NextFluentChip mounted when isDone', () => {
    // The trigger maps `done` → `outcome: 'ok'` and `failed` → `outcome: 'failed'`.
    expect(PANEL).toMatch(/outcome:\s*task\.status === 'done' \? 'ok' : 'failed'/);
  });
  test('IdleNudgeBadge mounted with task status passthrough', () => {
    expect(PANEL).toMatch(/status: task\.status as 'ready' \| 'running' \| 'review' \| 'blocked'/);
  });
  test('chip click events stop propagation so TaskCard selection is unaffected', () => {
    expect(PANEL).toMatch(/onClick=\{\(e\) => e\.stopPropagation\(\)\}/);
  });
});

describe('TaskManagerPanel · surfaceToHookKind whitelist', () => {
  test('passes through canonical TaskSurfaceKind values', () => {
    for (const kind of ['terminal-pane', 'vw-slot', 'subagent', 'skill', 'chat-prompt', 'cron', 'llm-direct', 'acx-session', 'showroom']) {
      expect(PANEL).toContain(`case '${kind}':`);
    }
  });
  test('non-canonical surface kinds default to null', () => {
    expect(PANEL).toMatch(/default:\s*return null;/);
  });
});
