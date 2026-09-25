import { describe, expect, test } from 'bun:test';

import {
  beginDashboardCodeEditTurn,
  formatDashboardTurnPromptPreview,
} from '../src/dashboard/code-edit-turn-runtime.js';

describe('formatDashboardTurnPromptPreview', () => {
  test('keeps short prompts and truncates long ones', () => {
    expect(formatDashboardTurnPromptPreview('short')).toBe('short');
    const long = 'a'.repeat(70);
    expect(formatDashboardTurnPromptPreview(long)).toBe(`${'a'.repeat(59)}…`);
  });
});

describe('beginDashboardCodeEditTurn', () => {
  test('starts both source delta and diff trackers', async () => {
    const events: string[] = [];

    await beginDashboardCodeEditTurn('hello world', {
      importCodeEdit: async () => ({
        getSourceDeltaManager: () => ({
          beginTurn: (meta) => { events.push(`source:${meta?.promptPreview}`); },
        }),
        getTurnDiffTracker: () => ({
          beginTurn: () => { events.push('diff'); },
        }),
      }),
    });

    expect(events).toEqual(['source:hello world', 'diff']);
  });

  test('swallows code-edit bootstrap failures', async () => {
    await expect(beginDashboardCodeEditTurn('hello', {
      importCodeEdit: async () => {
        throw new Error('boom');
      },
    })).resolves.toBeUndefined();
  });
});
