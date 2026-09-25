import { describe, expect, test } from 'bun:test';
import { renderTreeSyncAlert } from './tree-sync-alert.js';

describe('tree-sync-alert', () => {
  test('names the tree, the streak, the decision and the one command that shows the branch', () => {
    const text = renderTreeSyncAlert('/t', 3, 'tree sync unavailable (remote-unreadable): fatal');
    expect(text).toContain('3회 연속');
    expect(text).toContain('`/t`');
    expect(text).toContain('remote-unreadable');
    expect(text).toContain('git -C /t branch --show-current');
  });
});
