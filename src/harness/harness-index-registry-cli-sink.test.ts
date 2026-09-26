import { beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createRequire } from 'node:module';
import type { Command } from 'commander';

const calls: string[] = [];
let sinkShouldFail = false;

mock.module('../domains/standalone-log-sink.js', () => ({
  registerStandaloneLogSink: async (surface: string) => {
    calls.push(`sink:${surface}`);
    if (sinkShouldFail) throw new Error('logs.db unavailable');
  },
}));
const actualRoutingDrift = createRequire(import.meta.url)('../registry/llm-routing-drift.js');
mock.module('../registry/llm-routing-drift.js', () => ({
  ...actualRoutingDrift,
  detectRoutingDrift: () => {
    calls.push('action:drift');
    return [];
  },
  buildRoutingDriftRecommendation: () => 'recommendation',
}));

let program: Command;

beforeAll(async () => {
  ({ program } = await import('../index.js'));
  program.exitOverride();
});

beforeEach(() => {
  calls.length = 0;
  sinkShouldFail = false;
});

describe('production registry CLI sink wiring', () => {
  test('the actual index registry drift action registers its sink before running', async () => {
    await program.parseAsync(['node', 'elanous', 'registry', 'drift', '--json']);

    expect(calls).toEqual(['sink:registry', 'action:drift']);
  });

  test('the actual index registry drift action continues when sink registration fails', async () => {
    sinkShouldFail = true;

    await program.parseAsync(['node', 'elanous', 'registry', 'drift', '--json']);

    expect(calls).toEqual(['sink:registry', 'action:drift']);
  });
});
