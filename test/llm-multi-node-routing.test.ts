// H6 P2 Bundle 1 · LocalProvider multi-node routing tests.
//
// Validates the `local-llm:<node>:<model>` spec resolver via the
// manager cache. We don't hit any real HTTP endpoint — just check
// resolveBaseUrl + the provider's `available()` behaviour.

import { describe, test, expect, beforeEach } from 'bun:test';
import { refreshInventory, resolveBaseUrl, _resetManagerForTesting } from '../src/llm/local-manager/manager.js';
import { _resetSshHostsForTesting, setSshHostsForTesting } from '../src/ssh/ssh-hosts.js';
import { TEST_FLEET } from './fixtures/ssh-fleet.js';

const emptyJson = JSON.stringify({ models: [] });

beforeEach(() => {
  _resetManagerForTesting();
  _resetSshHostsForTesting();
  setSshHostsForTesting(TEST_FLEET);
});

describe('multi-node routing · resolveBaseUrl', () => {
  test('local node populates after probe', async () => {
    expect(resolveBaseUrl('local', 'any')).toBeNull();
    await refreshInventory({
      runLocal: async () => ({ stdout: emptyJson, stderr: '' }),
      runRemote: async () => ({ stdout: emptyJson, stderr: '' }),
      now: () => 1,
    });
    expect(resolveBaseUrl('local', 'any')).toBe('http://localhost:1234/v1');
  });

  test('remote node baseUrl uses ssh host', async () => {
    await refreshInventory({
      runLocal: async () => ({ stdout: emptyJson, stderr: '' }),
      runRemote: async (host) => {
        if (host === 'node-b') return { stdout: emptyJson, stderr: '' };
        throw new Error('Connection refused');
      },
      now: () => 1,
    });
    expect(resolveBaseUrl('node-b', 'any')).toBe('http://node-b:1234/v1');
    // unreachable nodes return null
    expect(resolveBaseUrl('mbp', 'any')).toBeNull();
  });

  test('unknown node returns null', () => {
    expect(resolveBaseUrl('not-a-node', 'any')).toBeNull();
  });
});

describe('multi-node routing · spec parsing (via types)', () => {
  test('spec parser handles local-llm:<node>:<model>', async () => {
    const { parseLocalLlmSpec } = await import('../src/llm/local-manager/types.js');
    const r = parseLocalLlmSpec('local-llm:node-b:qwen2.5-32b');
    expect(r?.nodeId).toBe('node-b');
    expect(r?.modelId).toBe('qwen2.5-32b');
  });
});
