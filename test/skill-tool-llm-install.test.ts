// H6 P2 Bundle 2 B · LlmRequestInstall LLM tool tests.

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  buildLlmRequestInstallTool,
  dispatchLlmRequestInstall,
} from '../src/skills/tools/llm-install.js';
import {
  updateNodeStatus,
  _resetNodeStatusForTesting,
} from '../src/llm/local-manager/node-registry.js';
import { _resetManagerForTesting } from '../src/llm/local-manager/manager.js';
import { _resetSshHostsForTesting, setSshHostsForTesting } from '../src/ssh/ssh-hosts.js';
import { TEST_FLEET } from './fixtures/ssh-fleet.js';
import type { ConfirmChannel, ConfirmRequest } from '../src/hitl/confirm.js';

beforeEach(() => {
  _resetManagerForTesting();
  _resetNodeStatusForTesting();
  _resetSshHostsForTesting();
  setSshHostsForTesting(TEST_FLEET);
});

function approver(answer: boolean): ConfirmChannel {
  return {
    name: 'terminal',
    async request(_r: ConfirmRequest) { return answer; },
    cancel() {},
  };
}

describe('buildLlmRequestInstallTool', () => {
  test('spec shape · required args · enum runtime', () => {
    const t = buildLlmRequestInstallTool();
    expect(t.name).toBe('LlmRequestInstall');
    const p = t.parameters as {
      properties: Record<string, { type?: string; enum?: readonly string[] }>;
      required?: readonly string[];
    };
    expect(p.properties.nodeId?.type).toBe('string');
    expect(p.properties.runtime?.enum).toEqual(['lmstudio', 'ollama']);
    expect(p.properties.modelName?.type).toBe('string');
    expect(p.properties.estimatedSizeBytes?.type).toBe('number');
    expect(p.required).toEqual(['nodeId', 'runtime', 'modelName']);
  });
});

describe('dispatchLlmRequestInstall', () => {
  test('happy path · metadata ok:true · output contains model name', async () => {
    updateNodeStatus('local', { reachable: true, runtimes: ['ollama'], at: 1 });
    const r = await dispatchLlmRequestInstall(
      {
        nodeId: 'local',
        runtime: 'ollama',
        modelName: 'llama3.1:8b',
      },
      {
        runLocal: async () => ({ stdout: 'pulled', stderr: '' }),
        confirmChannels: [approver(true)],
        onAfterInstall: async () => {},
      },
    );
    expect(r.isError).toBeUndefined();
    expect(r.metadata.ok).toBe(true);
    expect(r.metadata.modelName).toBe('llama3.1:8b');
    expect(r.output).toMatch(/llama3\.1:8b/);
    expect(r.output).toMatch(/installed/);
  });

  test('missing args · bad-args · isError:true', async () => {
    const r = await dispatchLlmRequestInstall({});
    expect(r.isError).toBe(true);
    expect(r.metadata.ok).toBe(false);
    expect(r.metadata.reason).toBe('bad-args');
  });

  test('invalid runtime · unsupported-runtime · isError:true', async () => {
    const r = await dispatchLlmRequestInstall({
      nodeId: 'local',
      runtime: 'mlx',
      modelName: 'some',
    });
    expect(r.isError).toBe(true);
    expect(r.metadata.ok).toBe(false);
    expect(r.metadata.reason).toBe('unsupported-runtime');
  });

  test('user-denied surfaces as isError:true · reason=user-denied', async () => {
    updateNodeStatus('local', { reachable: true, runtimes: ['ollama'], at: 1 });
    const r = await dispatchLlmRequestInstall(
      {
        nodeId: 'local',
        runtime: 'ollama',
        modelName: 'llama3.1:8b',
      },
      {
        runLocal: async () => ({ stdout: '', stderr: '' }),
        confirmChannels: [approver(false)],
        onAfterInstall: async () => {},
      },
    );
    expect(r.isError).toBe(true);
    expect(r.metadata.reason).toBe('user-denied');
  });

  test('unreachable node surfaces as isError:true · reason=unreachable', async () => {
    updateNodeStatus('mbp', { reachable: false, runtimes: [], at: 1 });
    const r = await dispatchLlmRequestInstall(
      {
        nodeId: 'mbp',
        runtime: 'ollama',
        modelName: 'llama3.1:70b',
      },
      { confirmChannels: [approver(true)], onAfterInstall: async () => {} },
    );
    expect(r.isError).toBe(true);
    expect(r.metadata.reason).toBe('unreachable');
  });

  test('passes estimatedSizeBytes through · triggers disk precheck', async () => {
    updateNodeStatus('local', { reachable: true, runtimes: ['ollama'], at: 1 });
    // Insufficient disk · 4 GB required × 1.5 = 6 GB · have ~1 GB
    const df = [
      'Filesystem     1024-blocks       Used Available Capacity',
      '/dev/disk3s1s1  1000000   500000   1000000    34%',
    ].join('\n');
    const r = await dispatchLlmRequestInstall(
      {
        nodeId: 'local',
        runtime: 'ollama',
        modelName: 'llama3.1:8b',
        estimatedSizeBytes: 4 * 1024 * 1024 * 1024,
      },
      {
        runLocal: async (argv) => {
          if (argv[0] === 'df') return { stdout: df, stderr: '' };
          return { stdout: '', stderr: '' };
        },
        confirmChannels: [approver(true)],
        onAfterInstall: async () => {},
      },
    );
    expect(r.isError).toBe(true);
    expect(r.metadata.reason).toBe('disk-low');
  });
});
