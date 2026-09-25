import { describe, expect, test } from 'bun:test';

import { bootDashboardSlashExecutor } from '../src/dashboard/slash-executor-boot.js';
import type { SlashExecuteHandler, SlashExecuteResult } from '../src/skills/tools/dashboard-slash.js';

describe('bootDashboardSlashExecutor', () => {
  test('wires immediate slash execution path', async () => {
    let handler: SlashExecuteHandler | undefined;
    const lines: string[] = [];
    let draws = 0;

    bootDashboardSlashExecutor({
      initDashboardSlashExecutor: (next) => { handler = next; },
      allowedSlashes: ['status'],
      executeImmediateDashboardSlash: () => ({
        ok: true,
        name: 'status',
        args: [],
        logLines: ['line A', 'line B'],
      }),
      immediateDeps: {
        getStatusLines: () => [],
      },
      appendInputPrefix: () => { throw new Error('should not queue'); },
      pushMutedLine: (line) => { lines.push(line); },
      pushMutedLines: (next) => { lines.push(...next); },
      draw: () => { draws += 1; },
    });

    const result = await handler?.({ name: 'status', args: [] }) as SlashExecuteResult;
    expect(result.logLines).toEqual(['line A', 'line B']);
    expect(lines).toEqual(['  line A', '  line B']);
    expect(draws).toBe(1);
  });

  test('queues non-immediate slash into input prefix', async () => {
    let handler: SlashExecuteHandler | undefined;
    const lines: string[] = [];
    const prefixes: string[] = [];
    let draws = 0;

    bootDashboardSlashExecutor({
      initDashboardSlashExecutor: (next) => { handler = next; },
      allowedSlashes: ['window'],
      executeImmediateDashboardSlash: () => null,
      immediateDeps: {
        getStatusLines: () => [],
      },
      appendInputPrefix: (text) => { prefixes.push(text); },
      pushMutedLine: (line) => { lines.push(line); },
      pushMutedLines: () => {},
      draw: () => { draws += 1; },
    });

    const result = await handler?.({ name: 'window', args: ['new', 'scratch'] }) as SlashExecuteResult;
    expect(prefixes).toEqual(['/window new scratch ']);
    expect(lines).toEqual(['  → queued slash: /window new scratch  (press Enter to execute)']);
    expect(result.logLines).toEqual(['queued /window new scratch into input — user confirms with Enter']);
    expect(draws).toBe(1);
  });

  test('rejects names outside the allow-list', async () => {
    let handler: SlashExecuteHandler | undefined;
    bootDashboardSlashExecutor({
      initDashboardSlashExecutor: (next) => { handler = next; },
      allowedSlashes: ['status'],
      executeImmediateDashboardSlash: () => {
        throw new Error('should not run');
      },
      immediateDeps: {
        getStatusLines: () => [],
      },
      appendInputPrefix: () => {
        throw new Error('should not queue');
      },
      pushMutedLine: () => {},
      pushMutedLines: () => {},
      draw: () => {},
    });

    const result = await handler?.({ name: 'window', args: [] }) as SlashExecuteResult;
    expect(result).toEqual({
      ok: false,
      name: 'window',
      args: [],
      message: 'blocked by allow-list',
    });
  });
});
