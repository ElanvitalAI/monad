// H6 P2 Bundle 1 · /llm slash tests.

import { describe, test, expect, beforeEach } from 'bun:test';
import { executeLlmSlash } from '../src/skills/tools/llm-manager-slash.js';
import { refreshInventory, _resetManagerForTesting } from '../src/llm/local-manager/manager.js';
import { _resetSshHostsForTesting } from '../src/ssh/ssh-hosts.js';

const emptyJson = JSON.stringify({ models: [] });
// Fleet fixups 2026-04-22 · LM Studio probe reads OpenAI-compat shape.
const oneModelJson = JSON.stringify({
  object: 'list',
  data: [{ id: 'solo-model', object: 'model' }],
});

const emptyFakes = () => ({
  runLocal: async (): Promise<{ stdout: string; stderr: string }> => ({ stdout: emptyJson, stderr: '' }),
  runRemote: async (): Promise<{ stdout: string; stderr: string }> => ({ stdout: emptyJson, stderr: '' }),
  now: () => 1000,
});
// Only LM Studio curl (:1234) gets the payload; other 3 probes throw
// daemon-down so the single-runtime node surfaces cleanly.
const oneModelFakes = () => ({
  runLocal: async (argv: readonly string[]): Promise<{ stdout: string; stderr: string }> => {
    // Probe hits /api/v0/models first (post-2026-05-05); /v1/models
    // is only the fallback for older LM Studio installs. Match both
    // so this fake stays accurate against the new probe path.
    if (argv.some((a) => a.includes(':1234/api/v0/models')
      || a.includes(':1234/v1/models'))) {
      return { stdout: oneModelJson, stderr: '' };
    }
    throw new Error('curl exited 7 · connection refused');
  },
  runRemote: async (): Promise<{ stdout: string; stderr: string }> => ({ stdout: emptyJson, stderr: '' }),
  now: () => 1000,
});

beforeEach(() => {
  _resetManagerForTesting();
  _resetSshHostsForTesting();
});

describe('executeLlmSlash · routing + help', () => {
  test('rejects non-llm slash name', async () => {
    const r = await executeLlmSlash({ name: 'reply', args: [] });
    expect(r).toBeNull();
  });

  test('help with empty args', async () => {
    const r = await executeLlmSlash({ name: 'llm', args: [] });
    expect(r).not.toBeNull();
    expect(r!.ok).toBe(true);
    expect(r!.logLines.some((l) => l.includes('local LLM'))).toBe(true);
    expect(r!.logLines.some((l) => l.includes('local-llm:<nodeId>:<modelId>'))).toBe(true);
  });

  test('help subcommand', async () => {
    const r = await executeLlmSlash({ name: 'llm', args: ['help'] });
    expect(r!.ok).toBe(true);
  });

  test('unknown subcommand errors', async () => {
    const r = await executeLlmSlash({ name: 'llm', args: ['fizzbuzz'] });
    expect(r!.ok).toBe(false);
    expect(r!.logLines.join(' ')).toContain('unknown subcommand');
  });
});

describe('executeLlmSlash · nodes', () => {
  test('nodes subcommand returns topology', async () => {
    await refreshInventory(emptyFakes());
    const r = await executeLlmSlash({ name: 'llm', args: ['nodes'] }, emptyFakes());
    expect(r!.ok).toBe(true);
    expect(r!.logLines.some((l) => l.includes('local'))).toBe(true);
  });
});

describe('executeLlmSlash · models', () => {
  test('models listing after probe', async () => {
    await refreshInventory(oneModelFakes());
    const r = await executeLlmSlash({ name: 'llm', args: ['models'] }, oneModelFakes());
    expect(r!.ok).toBe(true);
    expect(r!.logLines.some((l) => l.includes('local-llm:local:solo-model'))).toBe(true);
  });

  test('models --node filter', async () => {
    await refreshInventory(oneModelFakes());
    const r = await executeLlmSlash({ name: 'llm', args: ['models', '--node', 'local'] }, oneModelFakes());
    expect(r!.ok).toBe(true);
  });

  test('models --node without value errors', async () => {
    const r = await executeLlmSlash({ name: 'llm', args: ['models', '--node'] });
    expect(r!.ok).toBe(false);
    expect(r!.logLines.join(' ')).toContain('--node requires');
  });

  test('models unknown flag errors', async () => {
    const r = await executeLlmSlash({ name: 'llm', args: ['models', '--bogus'] });
    expect(r!.ok).toBe(false);
    expect(r!.logLines.join(' ')).toContain('unknown argument');
  });
});

describe('executeLlmSlash · refresh', () => {
  test('refresh subcommand', async () => {
    const r = await executeLlmSlash({ name: 'llm', args: ['refresh'] }, emptyFakes());
    expect(r).not.toBeNull();
    expect(r!.logLines.join(' ')).toContain('/llm refresh');
  });
});
