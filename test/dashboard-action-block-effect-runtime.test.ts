import { describe, expect, test } from 'bun:test';

import { runDashboardActionBlockEffects } from '../src/dashboard/action-block-effect-runtime.js';

describe('runDashboardActionBlockEffects', () => {
  test('logs applied state without autorun', async () => {
    const lines: string[] = [];
    await runDashboardActionBlockEffects({
      outcome: { applied: ['2 skills'], autoRun: null },
      info: (text) => `info:${text}`,
      highlight: (text) => `hi:${text}`,
      brainIcon: '[brain]',
      syncIcon: '[sync]',
      diffIcon: '[diff]',
      pushChatLine: (line) => { lines.push(line); },
      setChatScrollBottom: () => { lines.push('scroll'); },
      draw: () => { lines.push('draw'); },
      runSyncInline: async () => { lines.push('sync'); },
      runDiffInline: async () => { lines.push('diff'); },
    });
    expect(lines).toEqual(['info:[brain] Action applied: 2 skills']);
  });

  test('runs sync autorun with draw and scroll', async () => {
    const lines: string[] = [];
    await runDashboardActionBlockEffects({
      outcome: { applied: ['2 skills'], autoRun: 'sync' },
      info: (text) => `info:${text}`,
      highlight: (text) => `hi:${text}`,
      brainIcon: '[brain]',
      syncIcon: '[sync]',
      diffIcon: '[diff]',
      pushChatLine: (line) => { lines.push(line); },
      setChatScrollBottom: () => { lines.push('scroll'); },
      draw: () => { lines.push('draw'); },
      runSyncInline: async () => { lines.push('sync'); },
      runDiffInline: async () => { lines.push('diff'); },
    });
    expect(lines).toEqual([
      'info:[brain] Action applied: 2 skills',
      'hi:[sync] Auto-executing sync...',
      'scroll',
      'draw',
      'sync',
    ]);
  });
});
