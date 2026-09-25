// H6 P2 Bundle 1 · LLM tool dispatcher tests.

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  buildLlmListNodesTool,
  buildLlmListAvailableModelsTool,
  dispatchLlmListNodes,
  dispatchLlmListAvailableModels,
} from '../src/skills/tools/llm-manager.js';
import { refreshInventory, _resetManagerForTesting } from '../src/llm/local-manager/manager.js';
import { _resetSshHostsForTesting, setSshHostsForTesting } from '../src/ssh/ssh-hosts.js';
import { TEST_FLEET } from './fixtures/ssh-fleet.js';

const emptyJson = JSON.stringify({ models: [] });
// Fleet fixups 2026-04-22 · LM Studio probe reads OpenAI-compat shape.
const twoModelsJson = JSON.stringify({
  object: 'list',
  data: [
    { id: 'alpha-7b', object: 'model' },
    { id: 'beta-13b', object: 'model' },
  ],
});

// Fakes used by both the seed call and the subsequent dispatch so
// `getInventory` cache staleness comparison uses the same clock.
// Only the LM Studio curl (:1234) gets the payload; other probes
// throw daemon-down so we model a single-runtime node cleanly.
const fakes = () => ({
  runLocal: async (argv: readonly string[]): Promise<{ stdout: string; stderr: string }> => {
    // /api/v0/models is the post-2026-05-05 primary; /v1/models is
    // the fallback for older LM Studio. Match both.
    if (argv.some((a) => a.includes(':1234/api/v0/models')
      || a.includes(':1234/v1/models'))) {
      return { stdout: twoModelsJson, stderr: '' };
    }
    throw new Error('curl exited 7 · connection refused');
  },
  runRemote: async (): Promise<{ stdout: string; stderr: string }> => ({ stdout: emptyJson, stderr: '' }),
  now: () => 1000,
});

async function seedInventoryLocalOnly(): Promise<void> {
  await refreshInventory(fakes());
}

beforeEach(() => {
  _resetManagerForTesting();
  _resetSshHostsForTesting();
  setSshHostsForTesting(TEST_FLEET);
});

describe('buildLlmListNodesTool', () => {
  test('spec shape', () => {
    const spec = buildLlmListNodesTool();
    expect(spec.name).toBe('LlmListNodes');
    expect(spec.parameters.properties).toHaveProperty('refresh');
  });
});

describe('buildLlmListAvailableModelsTool', () => {
  test('spec shape', () => {
    const spec = buildLlmListAvailableModelsTool();
    expect(spec.name).toBe('LlmListAvailableModels');
    expect(spec.parameters.properties).toHaveProperty('node');
    expect(spec.parameters.properties).toHaveProperty('refresh');
  });
});

describe('dispatchLlmListNodes', () => {
  test('happy path · metadata contains nodes + reachableCount', async () => {
    await seedInventoryLocalOnly();
    const r = await dispatchLlmListNodes({}, fakes());
    expect(r.isError).toBeUndefined();
    expect(r.metadata.nodes.length).toBeGreaterThanOrEqual(6);
    expect(r.metadata.cached).toBe(true);
    expect(r.metadata.reachableCount).toBeGreaterThanOrEqual(1);
    expect(r.output).toContain('LlmListNodes');
    expect(r.output).toContain('local');
  });

  test('refresh:true bypasses cache', async () => {
    // No prior probes · refresh still works but will still probe
    // (runners default to prod · expect them to fail gracefully).
    // We assert shape, not real results here.
    const r = await dispatchLlmListNodes({ refresh: true }, fakes());
    expect(r.isError).toBeUndefined();
    expect(r.metadata.cached).toBe(false);
  });
});

describe('dispatchLlmListAvailableModels', () => {
  test('no filter returns all models · metadata.countByNode populated', async () => {
    await seedInventoryLocalOnly();
    const r = await dispatchLlmListAvailableModels({}, fakes());
    expect(r.metadata.models).toHaveLength(2);
    expect(r.metadata.countByNode.local).toBe(2);
    expect(r.output).toContain('local-llm:local:alpha-7b');
    expect(r.output).toContain('local-llm:local:beta-13b');
  });

  test('node filter restricts output', async () => {
    await seedInventoryLocalOnly();
    const r = await dispatchLlmListAvailableModels({ node: 'local' }, fakes());
    expect(r.metadata.models.every((m) => m.nodeId === 'local')).toBe(true);
    expect(r.metadata.filteredBy?.node).toBe('local');
  });

  test('unknown node filter returns empty', async () => {
    await seedInventoryLocalOnly();
    const r = await dispatchLlmListAvailableModels({ node: 'ghost' }, fakes());
    expect(r.metadata.models).toEqual([]);
    expect(r.output).toContain('0 model');
  });

  test('empty inventory shows guidance hint', async () => {
    // Fresh cache probed with all-empty fakes.
    const r = await dispatchLlmListAvailableModels({}, {
      runLocal: async () => ({ stdout: emptyJson, stderr: '' }),
      runRemote: async () => ({ stdout: emptyJson, stderr: '' }),
      now: () => 1000,
    });
    expect(r.output).toContain('(empty');
  });
});
