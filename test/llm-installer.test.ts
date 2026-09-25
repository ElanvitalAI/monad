// H6 P2 Bundle 2 B · Installer tests.
//
// Covers the requestInstall() workflow end-to-end with injected fakes:
//   - Node validation (unknown / unreachable / supported runtimes)
//   - Disk precheck (`df -k` output parsing · threshold = size × 1.5)
//   - HITL gate (approve / reject / timeout) via injected ConfirmChannels
//   - Runtime-aware command spawn (`lms get` vs `ollama pull`)
//   - Manager cache invalidation on success

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  requestInstall,
  parseDfAvailableBytes,
  type InstallerDeps,
} from '../src/llm/local-manager/installer.js';
import type {
  ConfirmChannel,
  ConfirmRequest,
} from '../src/hitl/confirm.js';
import {
  updateNodeStatus,
  _resetNodeStatusForTesting,
} from '../src/llm/local-manager/node-registry.js';
import { _resetManagerForTesting } from '../src/llm/local-manager/manager.js';
import { _resetSshHostsForTesting, setSshHostsForTesting } from '../src/ssh/ssh-hosts.js';
import { TEST_FLEET } from './fixtures/ssh-fleet.js';

beforeEach(() => {
  _resetManagerForTesting();
  _resetNodeStatusForTesting();
  _resetSshHostsForTesting();
  setSshHostsForTesting(TEST_FLEET);
});

/** Always-approve HITL channel. */
function fakeChannel(answer: boolean, name = 'terminal'): ConfirmChannel {
  return {
    name,
    async request(_req: ConfirmRequest) {
      return answer;
    },
    cancel() { /* noop */ },
  };
}

/** Channel that never responds (useful for forcing timeout). */
function silentChannel(name = 'terminal'): ConfirmChannel {
  return {
    name,
    async request(_req: ConfirmRequest) {
      return new Promise<null>(() => {
        // never resolves · simulates channel waiting indefinitely
      });
    },
    cancel() { /* noop */ },
  };
}

function stageReachable(nodeId: string) {
  updateNodeStatus(nodeId, { reachable: true, runtimes: ['lmstudio'], at: 1 });
}

function baseDeps(overrides: Partial<InstallerDeps> = {}): InstallerDeps {
  return {
    runLocal: async () => ({ stdout: '', stderr: '' }),
    runRemote: async () => ({ stdout: '', stderr: '' }),
    now: () => 1000,
    onAfterInstall: async () => { /* no-op · skip real refresh in tests */ },
    ...overrides,
  };
}

describe('parseDfAvailableBytes', () => {
  test('typical macOS `df -k` output', () => {
    const stdout = [
      'Filesystem     1024-blocks       Used Available Capacity iused  ifree %iused  Mounted on',
      '/dev/disk3s1s1  3852140312 1012345678 2839794634    27%  987654 123456   89%   /',
    ].join('\n');
    const r = parseDfAvailableBytes(stdout);
    expect(r).toBe(2839794634 * 1024);
  });

  test('Linux `df -k` output shape', () => {
    const stdout = [
      'Filesystem     1K-blocks      Used Available Use% Mounted on',
      '/dev/sda1     1048576000 500000000 500000000  50% /',
    ].join('\n');
    expect(parseDfAvailableBytes(stdout)).toBe(500000000 * 1024);
  });

  test('malformed output returns undefined', () => {
    expect(parseDfAvailableBytes('')).toBeUndefined();
    expect(parseDfAvailableBytes('garbage')).toBeUndefined();
  });
});

describe('requestInstall · validation', () => {
  test('unknown node · unknown-node reason', async () => {
    const r = await requestInstall(
      { nodeId: 'ghost', runtime: 'lmstudio', modelName: 'qwen' },
      baseDeps({ confirmChannels: [fakeChannel(true)] }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('unknown-node');
  });

  test('unreachable node · unreachable reason', async () => {
    updateNodeStatus('mbp', { reachable: false, runtimes: [], at: 1 });
    const r = await requestInstall(
      { nodeId: 'mbp', runtime: 'lmstudio', modelName: 'qwen' },
      baseDeps({ confirmChannels: [fakeChannel(true)] }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('unreachable');
  });

  test('unsupported runtime (mlx) · unsupported-runtime reason', async () => {
    stageReachable('local');
    const r = await requestInstall(
      { nodeId: 'local', runtime: 'mlx', modelName: 'some' },
      baseDeps({ confirmChannels: [fakeChannel(true)] }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('unsupported-runtime');
  });
});

describe('requestInstall · disk precheck (D26)', () => {
  test('free < size × 1.5 → disk-low reason', async () => {
    stageReachable('local');
    const df = [
      'Filesystem     1024-blocks       Used Available Capacity',
      '/dev/disk3s1s1  100000000   50000000   2000000    98%',
    ].join('\n');
    const r = await requestInstall(
      {
        nodeId: 'local',
        runtime: 'ollama',
        modelName: 'llama3.1:8b',
        estimatedSizeBytes: 4 * 1024 * 1024 * 1024, // 4 GB · need 6 GB · have ~2 GB (2000000 × 1024 ~= 2 GB)
      },
      baseDeps({
        runLocal: async (argv) => {
          if (argv[0] === 'df') return { stdout: df, stderr: '' };
          return { stdout: '', stderr: '' };
        },
        confirmChannels: [fakeChannel(true)],
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('disk-low');
      expect(r.message).toMatch(/need/);
      expect(r.message).toMatch(/have/);
    }
  });

  test('free > size × 1.5 → proceed through HITL + install', async () => {
    stageReachable('local');
    const df = [
      'Filesystem     1024-blocks       Used Available Capacity',
      '/dev/disk3s1s1  1000000000 200000000 800000000    21%',
    ].join('\n');
    let installed = false;
    const r = await requestInstall(
      {
        nodeId: 'local',
        runtime: 'ollama',
        modelName: 'llama3.1:8b',
        estimatedSizeBytes: 4 * 1024 * 1024 * 1024, // need 6 GB · have ~800 GB
      },
      baseDeps({
        runLocal: async (argv) => {
          if (argv[0] === 'df') return { stdout: df, stderr: '' };
          if (argv[0] === 'ollama') {
            installed = true;
            return { stdout: 'pulling...done', stderr: '' };
          }
          return { stdout: '', stderr: '' };
        },
        confirmChannels: [fakeChannel(true)],
      }),
    );
    expect(r.ok).toBe(true);
    expect(installed).toBe(true);
  });

  test('no estimated size · skips precheck · proceeds', async () => {
    stageReachable('local');
    let sawDf = false;
    const r = await requestInstall(
      { nodeId: 'local', runtime: 'lmstudio', modelName: 'qwen' },
      baseDeps({
        runLocal: async (argv) => {
          if (argv[0] === 'df') { sawDf = true; return { stdout: '', stderr: '' }; }
          return { stdout: 'ok', stderr: '' };
        },
        confirmChannels: [fakeChannel(true)],
      }),
    );
    expect(r.ok).toBe(true);
    expect(sawDf).toBe(false);
  });
});

describe('requestInstall · HITL gate', () => {
  test('user approves · runs install · returns ok:true', async () => {
    stageReachable('local');
    const r = await requestInstall(
      { nodeId: 'local', runtime: 'ollama', modelName: 'llama3.1:8b' },
      baseDeps({ confirmChannels: [fakeChannel(true)] }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.modelName).toBe('llama3.1:8b');
  });

  test('user denies · no install · reason=user-denied', async () => {
    stageReachable('local');
    let installed = false;
    const r = await requestInstall(
      { nodeId: 'local', runtime: 'ollama', modelName: 'llama3.1:8b' },
      baseDeps({
        runLocal: async (argv) => {
          if (argv[0] === 'ollama') { installed = true; return { stdout: '', stderr: '' }; }
          return { stdout: '', stderr: '' };
        },
        confirmChannels: [fakeChannel(false)],
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('user-denied');
    expect(installed).toBe(false);
  });

  test('HITL timeout · reason=user-timeout', async () => {
    stageReachable('local');
    const r = await requestInstall(
      { nodeId: 'local', runtime: 'ollama', modelName: 'llama3.1:8b', confirmTimeoutMs: 40 },
      baseDeps({ confirmChannels: [silentChannel()] }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('user-timeout');
  });
});

describe('requestInstall · runtime-aware command spawn', () => {
  test('lmstudio → `lms get <model>`', async () => {
    stageReachable('local');
    let seenArgv: readonly string[] | undefined;
    await requestInstall(
      { nodeId: 'local', runtime: 'lmstudio', modelName: 'lmstudio-community/qwen' },
      baseDeps({
        runLocal: async (argv) => {
          if (argv[0] !== 'df') seenArgv = argv;
          return { stdout: '', stderr: '' };
        },
        confirmChannels: [fakeChannel(true)],
      }),
    );
    expect(seenArgv?.slice(0, 2)).toEqual(['lms', 'get']);
    expect(seenArgv?.some((arg) => arg.includes('lmstudio-community/qwen'))).toBe(true);
  });

  test('ollama → `ollama pull <model>`', async () => {
    stageReachable('local');
    const modelName = 'llama3.1:8b';
    let seenArgv: readonly string[] | undefined;
    await requestInstall(
      { nodeId: 'local', runtime: 'ollama', modelName },
      baseDeps({
        runLocal: async (argv) => {
          if (argv[0] !== 'df') seenArgv = argv;
          return { stdout: '', stderr: '' };
        },
        confirmChannels: [fakeChannel(true)],
      }),
    );
    expect(seenArgv?.slice(0, 2)).toEqual(['ollama', 'pull']);
    expect(seenArgv?.some((arg) => arg.includes(modelName))).toBe(true);
  });

  test('remote node · runs via runRemote with host', async () => {
    updateNodeStatus('node-b', { reachable: true, runtimes: ['ollama'], at: 1 });
    let seenHost: string | undefined;
    let seenArgv: readonly string[] | undefined;
    await requestInstall(
      { nodeId: 'node-b', runtime: 'ollama', modelName: 'llama3.1:70b' },
      baseDeps({
        runRemote: async (host, argv) => {
          if (argv[0] !== 'df') {
            seenHost = host;
            seenArgv = argv;
          }
          return { stdout: '', stderr: '' };
        },
        confirmChannels: [fakeChannel(true)],
      }),
    );
    expect(seenHost).toBe('node-b');
    expect(seenArgv).toEqual(['ollama', 'pull', 'llama3.1:70b']);
  });

  test('install command exit non-zero → install-failed', async () => {
    stageReachable('local');
    const r = await requestInstall(
      { nodeId: 'local', runtime: 'ollama', modelName: 'llama3.1:8b' },
      baseDeps({
        runLocal: async (argv) => {
          if (argv[0] === 'ollama') throw new Error('ollama pull exited 1 · stderr=not found');
          return { stdout: '', stderr: '' };
        },
        confirmChannels: [fakeChannel(true)],
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('install-failed');
  });
});

describe('requestInstall · cache invalidation', () => {
  test('onAfterInstall hook fires on success', async () => {
    stageReachable('local');
    let hookFired = 0;
    const r = await requestInstall(
      { nodeId: 'local', runtime: 'ollama', modelName: 'llama3.1:8b' },
      baseDeps({
        onAfterInstall: async () => { hookFired += 1; },
        confirmChannels: [fakeChannel(true)],
      }),
    );
    expect(r.ok).toBe(true);
    expect(hookFired).toBe(1);
  });

  test('onAfterInstall does NOT fire on user-denied', async () => {
    stageReachable('local');
    let hookFired = 0;
    await requestInstall(
      { nodeId: 'local', runtime: 'ollama', modelName: 'llama3.1:8b' },
      baseDeps({
        onAfterInstall: async () => { hookFired += 1; },
        confirmChannels: [fakeChannel(false)],
      }),
    );
    expect(hookFired).toBe(0);
  });
});
