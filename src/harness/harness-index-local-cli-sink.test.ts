import { afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import type { Command } from 'commander';
import * as ui from '../ui.js';

const calls: string[] = [];
let sinkShouldFail = false;

mock.module('../domains/standalone-log-sink.js', () => ({
  registerStandaloneLogSink: async (surface: string) => {
    calls.push(`sink:${surface}`);
    if (sinkShouldFail) throw new Error('logs.db unavailable');
  },
}));

let program: Command;
let infoSpy: ReturnType<typeof spyOn>;

beforeAll(async () => {
  ({ program } = await import('../index.js'));
  program.exitOverride();
});

beforeEach(() => {
  calls.length = 0;
  sinkShouldFail = false;
  infoSpy = spyOn(ui, 'info').mockImplementation(((message: string) => {
    calls.push(`action:${message.startsWith('스코어 파일 없음') ? 'scores' : message}`);
  }) as never);
});

afterEach(() => infoSpy.mockRestore());

describe('production local CLI sink wiring', () => {
  test('the actual index local scores action registers its sink before running', async () => {
    await program.parseAsync(['node', 'elanous', 'local', 'scores']);

    expect(calls).toEqual(['sink:local', 'action:scores']);
  });

  test('the actual index local scores action continues when sink registration fails', async () => {
    sinkShouldFail = true;

    await program.parseAsync(['node', 'elanous', 'local', 'scores']);

    expect(calls).toEqual(['sink:local', 'action:scores']);
  });
});
