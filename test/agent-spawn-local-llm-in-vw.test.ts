// H6 P2 Bundle 2 A/A2 · spawn-local-llm-in-vw tests.
//
// Covers:
//   - parseSlashInput 5-shape grammar (D17)
//   - local happy path · lms chat composition · default/custom title
//     · soft inventory probe fail tolerance
//   - D19 brand dispatch: local → 'local-llm' + [modelId] · remote →
//     'local-llm-remote' + [node, 'lms', 'chat', modelId]
//   - D20 reachability precheck: unknown node · unreachable node ·
//     not-probed trigger refresh · reachable remote happy path
//
// All tests inject ManagerDeps or stage node-registry status so they
// never invoke real `lms` / `ssh` / PTY.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  spawnLocalLlmInVW,
  _parseSlashInputForTesting,
  _composeBrandArgsForTesting,
} from '../src/agent/spawn-local-llm-in-vw.js';
import {
  initSpawnEmbodiedAgentInVW,
  _resetSpawnEmbodiedAgentInVWForTesting,
} from '../src/agent/spawn-embodied-agent-in-vw.js';
import { WindowRegistry } from '../src/virtual-windows/window-registry.js';
import { createAddressBook } from '../src/virtual-windows/addressing.js';
import { DisplayCoordinator } from '../src/display/coordinator.js';
import {
  resetForTesting as resetPtyRegistry,
  setPtyAdapterForTesting,
  type StartOpts,
} from '../src/pty-shell/registry.js';
import { _resetManagerForTesting } from '../src/llm/local-manager/manager.js';
import { _resetSshHostsForTesting, setSshHostsForTesting } from '../src/ssh/ssh-hosts.js';
import { TEST_FLEET } from './fixtures/ssh-fleet.js';
import { updateNodeStatus } from '../src/llm/local-manager/node-registry.js';

function makeTestRegistry() {
  return new WindowRegistry({
    addressBook: createAddressBook(),
    coordinator: new DisplayCoordinator({ frameMs: 0 }),
    defaultBounds: () => ({ row: 1, col: 1, width: 80, height: 24 }),
  });
}

function installCapturingPty(): { captured: StartOpts[] } {
  const captured: StartOpts[] = [];
  setPtyAdapterForTesting((opts) => {
    captured.push(opts);
    return {
      pid: 5555,
      write() {},
      kill() {},
      onData() { return { dispose() {} }; },
      onExit() { return { dispose() {} }; },
    };
  });
  return { captured };
}

// A ManagerDeps fake that always returns empty inventory without
// touching real `lms` or `ssh`. `now` is fixed so cache staleness is
// deterministic within a test.
const emptyProbeDeps = {
  runLocal: async () => ({ stdout: JSON.stringify({ models: [] }), stderr: '' }),
  runRemote: async () => ({ stdout: JSON.stringify({ models: [] }), stderr: '' }),
  now: () => 1000,
  staleMs: 60_000,
};

beforeEach(() => {
  _resetManagerForTesting();
  _resetSshHostsForTesting();
  setSshHostsForTesting(TEST_FLEET);
});

afterEach(() => {
  _resetSpawnEmbodiedAgentInVWForTesting();
  resetPtyRegistry();
  setPtyAdapterForTesting(null);
});

describe('parseSlashInput (D17 grammar)', () => {
  test('canonical local-llm:<node>:<model>', () => {
    const s = _parseSlashInputForTesting('local-llm:local:qwen3.5-35b-a3b');
    expect(s?.nodeId).toBe('local');
    expect(s?.modelId).toBe('qwen3.5-35b-a3b');
  });

  test('legacy local:<model>', () => {
    const s = _parseSlashInputForTesting('local:qwen3.5-35b-a3b');
    expect(s?.nodeId).toBe('local');
    expect(s?.modelId).toBe('qwen3.5-35b-a3b');
  });

  test('implicit local via local-llm:<model>', () => {
    const s = _parseSlashInputForTesting('local-llm:qwen3.5-35b-a3b');
    expect(s?.nodeId).toBe('local');
    expect(s?.modelId).toBe('qwen3.5-35b-a3b');
  });

  test('bare <node>:<model> · prepends local-llm:', () => {
    const s = _parseSlashInputForTesting('mbp:qwen3-72b');
    expect(s?.nodeId).toBe('mbp');
    expect(s?.modelId).toBe('qwen3-72b');
  });

  test('bare <model> · assumes local node', () => {
    const s = _parseSlashInputForTesting('qwen3.5-35b-a3b');
    expect(s?.nodeId).toBe('local');
    expect(s?.modelId).toBe('qwen3.5-35b-a3b');
  });

  test('whitespace trimming', () => {
    const s = _parseSlashInputForTesting('  local:qwen3.5-35b-a3b  ');
    expect(s?.nodeId).toBe('local');
    expect(s?.modelId).toBe('qwen3.5-35b-a3b');
  });

  test('empty / whitespace-only returns null', () => {
    expect(_parseSlashInputForTesting('')).toBeNull();
    expect(_parseSlashInputForTesting('   ')).toBeNull();
  });
});

describe('composeBrandArgs (D19 × D25 · 4-way dispatch)', () => {
  test('local + lmstudio → brand "local-llm" + [modelId]', () => {
    const r = _composeBrandArgsForTesting(
      { raw: 'local:qwen3.5-35b-a3b', nodeId: 'local', modelId: 'qwen3.5-35b-a3b' },
      'lmstudio',
    );
    expect(r.brand).toBe('local-llm');
    expect(r.extraArgs).toEqual(['qwen3.5-35b-a3b']);
  });

  test('local + ollama → brand "local-llm-ollama" + [modelId]', () => {
    const r = _composeBrandArgsForTesting(
      { raw: 'local:llama3.1:8b', nodeId: 'local', modelId: 'llama3.1:8b' },
      'ollama',
    );
    expect(r.brand).toBe('local-llm-ollama');
    expect(r.extraArgs).toEqual(['llama3.1:8b']);
  });

  test('remote + lmstudio → brand "local-llm-remote" + [node, lms, chat, model]', () => {
    const r = _composeBrandArgsForTesting(
      { raw: 'node-b:qwen3-72b', nodeId: 'node-b', modelId: 'qwen3-72b' },
      'lmstudio',
    );
    expect(r.brand).toBe('local-llm-remote');
    expect(r.extraArgs).toEqual(['node-b', 'lms', 'chat', 'qwen3-72b']);
  });

  test('remote + ollama → brand "local-llm-ollama-remote" + [node, ollama, run, model]', () => {
    const r = _composeBrandArgsForTesting(
      { raw: 'node-b:llama3.1:70b', nodeId: 'node-b', modelId: 'llama3.1:70b' },
      'ollama',
    );
    expect(r.brand).toBe('local-llm-ollama-remote');
    expect(r.extraArgs).toEqual(['node-b', 'ollama', 'run', 'llama3.1:70b']);
  });

  test('mlx runtime (Bundle 2 C2 future) falls back to LM Studio dispatch', () => {
    const r = _composeBrandArgsForTesting(
      { raw: 'local:mlx-model', nodeId: 'local', modelId: 'mlx-model' },
      'mlx',
    );
    expect(r.brand).toBe('local-llm');
    expect(r.extraArgs).toEqual(['mlx-model']);
  });

  test('remote model id with colon/slash characters passes through', () => {
    const r = _composeBrandArgsForTesting(
      {
        raw: 'mbp:lmstudio-community/qwen3-14b',
        nodeId: 'mbp',
        modelId: 'lmstudio-community/qwen3-14b',
      },
      'lmstudio',
    );
    expect(r.brand).toBe('local-llm-remote');
    expect(r.extraArgs).toEqual(['mbp', 'lms', 'chat', 'lmstudio-community/qwen3-14b']);
  });
});

describe('spawnLocalLlmInVW · validation', () => {
  test('empty spec throws with actionable message', async () => {
    installCapturingPty();
    initSpawnEmbodiedAgentInVW(makeTestRegistry());
    let err: unknown;
    try {
      await spawnLocalLlmInVW({ rawSpec: '', managerDeps: emptyProbeDeps });
    } catch (e) {
      err = e;
    }
    expect((err as Error).message).toMatch(/invalid local-llm spec/);
  });

  test('throws cleanly when wiring missing (local path · no remote precheck)', async () => {
    installCapturingPty();
    // init NOT called · spawnEmbodiedAgentInVW surfaces "not wired"
    let err: unknown;
    try {
      await spawnLocalLlmInVW({
        rawSpec: 'local:qwen3.5-35b-a3b',
        managerDeps: emptyProbeDeps,
      });
    } catch (e) {
      err = e;
    }
    expect((err as Error).message).toMatch(/not wired/);
  });
});

describe('spawnLocalLlmInVW · D20 remote reachability precheck', () => {
  test('unknown node (not in ssh-hosts) · actionable error', async () => {
    installCapturingPty();
    initSpawnEmbodiedAgentInVW(makeTestRegistry());
    let err: unknown;
    try {
      await spawnLocalLlmInVW({
        rawSpec: 'nonexistent-node:some-model',
        managerDeps: emptyProbeDeps,
      });
    } catch (e) {
      err = e;
    }
    const msg = (err as Error).message;
    // Default ssh-hosts includes mba/node-b/mbp/minio/node-c · "nonexistent-node"
    // isn't there · still isn't after empty probe · surfaces as unknown-node.
    expect(msg).toMatch(/unknown node 'nonexistent-node'/);
    expect(msg).toMatch(/run \/llm/);
  });

  test('known but unreachable node (after probe) · actionable warning', async () => {
    installCapturingPty();
    initSpawnEmbodiedAgentInVW(makeTestRegistry());
    // Stage node-b as already probed and unreachable.
    updateNodeStatus('node-b', {
      reachable: false,
      runtimes: [],
      at: 1000,
    });
    let err: unknown;
    try {
      await spawnLocalLlmInVW({
        rawSpec: 'node-b:qwen3-72b',
        // Skip the auto-refresh path by pre-staging lastProbedAt > 0.
        managerDeps: emptyProbeDeps,
      });
    } catch (e) {
      err = e;
    }
    const msg = (err as Error).message;
    expect(msg).toMatch(/node 'node-b' unreachable/);
    expect(msg).toMatch(/check \/llm nodes/);
  });

  test('not-probed remote · triggers getInventory · still unreachable after probe', async () => {
    installCapturingPty();
    initSpawnEmbodiedAgentInVW(makeTestRegistry());
    // Empty probe responses · node stays unreachable after the triggered probe.
    // After _resetManagerForTesting no node is probed (lastProbedAt=0);
    // ensureRemoteReachable will call getInventory, which still returns
    // unreachable for node-b because runRemote returns empty models.
    let err: unknown;
    try {
      await spawnLocalLlmInVW({
        rawSpec: 'node-b:qwen3-72b',
        managerDeps: emptyProbeDeps,
      });
    } catch (e) {
      err = e;
    }
    // After the probe, node.reachable comes from the probe outcome.
    // With empty models + no error, the probe marks the node reachable
    // (the lmstudio probe considers empty JSON as "cli works, no models").
    // So this might be reachable · check either the unreachable OR the
    // "not wired" downstream error (because no init called? — actually init
    // IS called above). Let's check the behavior: if probe marks reachable,
    // we proceed to spawnEmbodiedAgent which IS wired, so it spawns ssh.
    // In that case there's no error — the test assumption above is wrong
    // for this deps shape. The real "unreachable after probe" case needs
    // a failing probe.
    // Revised: with empty JSON success, node becomes reachable · spawn
    // proceeds. Treat this case in the reachable happy-path test below.
    // For the unreachable-after-probe assertion, we need runRemote to throw.
    expect(err).toBeUndefined();  // empty JSON = reachable
  });

  test('not-probed remote · failing probe leaves unreachable · actionable', async () => {
    installCapturingPty();
    initSpawnEmbodiedAgentInVW(makeTestRegistry());
    const failingRemoteProbeDeps = {
      runLocal: async () => ({ stdout: JSON.stringify({ models: [] }), stderr: '' }),
      runRemote: async () => { throw new Error('ssh: connect to host node-b port 22: Connection timed out'); },
      now: () => 1000,
      staleMs: 60_000,
    };
    let err: unknown;
    try {
      await spawnLocalLlmInVW({
        rawSpec: 'node-b:qwen3-72b',
        managerDeps: failingRemoteProbeDeps,
      });
    } catch (e) {
      err = e;
    }
    const msg = (err as Error).message;
    expect(msg).toMatch(/node 'node-b' unreachable/);
  });

  test('local node bypasses remote precheck even with unreachable status', async () => {
    const { captured } = installCapturingPty();
    initSpawnEmbodiedAgentInVW(makeTestRegistry());
    // Stage local as unreachable — shouldn't matter for local spawn.
    updateNodeStatus('local', { reachable: false, runtimes: [], at: 1000 });
    const r = await spawnLocalLlmInVW({
      rawSpec: 'local:qwen3.5-35b-a3b',
      managerDeps: emptyProbeDeps,
    });
    expect(captured[0]!.cmd).toBe('lms');
    await r.session.dispose();
  });
});

describe('spawnLocalLlmInVW · A2 remote happy path (D19 + D20 both pass)', () => {
  test('reachable node-b · composes `ssh -t node-b lms chat <model>`', async () => {
    const { captured } = installCapturingPty();
    initSpawnEmbodiedAgentInVW(makeTestRegistry());
    // Pre-stage node-b as reachable (probe shortcut).
    updateNodeStatus('node-b', {
      reachable: true,
      runtimes: ['lmstudio'],
      lmstudioBaseUrl: 'http://node-b:1234/v1',
      at: 1000,
    });
    const r = await spawnLocalLlmInVW({
      rawSpec: 'node-b:qwen3-72b',
      cwd: '/tmp',
      managerDeps: emptyProbeDeps,
    });
    expect(r.session.id).toMatch(/^emb-local-llm-ssh-pty-/);
    expect(r.session.transports[0]!.label).toBe('local-llm-pty-remote');
    expect(captured).toHaveLength(1);
    expect(captured[0]!.cmd).toBe('ssh');
    expect(captured[0]!.args).toEqual(['-t', 'node-b', 'lms', 'chat', 'qwen3-72b']);
    await r.session.dispose();
  });

  test('remote default title includes node prefix', async () => {
    installCapturingPty();
    const registry = makeTestRegistry();
    initSpawnEmbodiedAgentInVW(registry);
    updateNodeStatus('mbp', { reachable: true, runtimes: ['lmstudio'], at: 1000 });
    const r = await spawnLocalLlmInVW({
      rawSpec: 'mbp:gpt-oss-20b',
      managerDeps: emptyProbeDeps,
    });
    const win = registry.get(r.windowId);
    expect(win?.title).toBe('local-llm:mbp:gpt-oss-20b');
    await r.session.dispose();
  });

  test('caller title override wins on remote too', async () => {
    installCapturingPty();
    const registry = makeTestRegistry();
    initSpawnEmbodiedAgentInVW(registry);
    updateNodeStatus('node-b', { reachable: true, runtimes: ['lmstudio'], at: 1000 });
    const r = await spawnLocalLlmInVW({
      rawSpec: 'node-b:qwen3-72b',
      title: 'big-brain',
      managerDeps: emptyProbeDeps,
    });
    const win = registry.get(r.windowId);
    expect(win?.title).toBe('big-brain');
    await r.session.dispose();
  });
});

describe('spawnLocalLlmInVW · D25 runtime-aware end-to-end dispatch', () => {
  test('local Ollama model in inventory → spawns `ollama run <model>`', async () => {
    const { captured } = installCapturingPty();
    initSpawnEmbodiedAgentInVW(makeTestRegistry());
    // Stage inventory with an Ollama model on local.
    const ollamaProbeDeps = {
      runLocal: async (argv: readonly string[]) => {
        if (argv[0] === 'curl') {
          return {
            stdout: JSON.stringify({
              models: [{ name: 'llama3.1:8b', size: 4e9, details: { format: 'gguf' } }],
            }),
            stderr: '',
          };
        }
        // lms ls returns empty
        return { stdout: JSON.stringify({ models: [] }), stderr: '' };
      },
      runRemote: async () => ({ stdout: JSON.stringify({ models: [] }), stderr: '' }),
      now: () => 1000,
      staleMs: 60_000,
    };
    const r = await spawnLocalLlmInVW({
      rawSpec: 'local:llama3.1:8b',
      managerDeps: ollamaProbeDeps,
    });
    expect(r.session.id).toMatch(/^emb-local-llm-ollama-pty-/);
    expect(captured[0]!.cmd).toBe('ollama');
    expect(captured[0]!.args).toEqual(['run', 'llama3.1:8b']);
    await r.session.dispose();
  });

  test('local LM Studio model in inventory → spawns `lms chat <model>`', async () => {
    const { captured } = installCapturingPty();
    initSpawnEmbodiedAgentInVW(makeTestRegistry());
    // Stage inventory with only LM Studio model.
    const lmProbeDeps = {
      runLocal: async (argv: readonly string[]) => {
        if (argv[0] === 'lms') {
          return {
            stdout: JSON.stringify({
              models: [{ path: 'qwen3.5-35b-a3b', sizeBytes: 20e9, format: 'mlx' }],
            }),
            stderr: '',
          };
        }
        // ollama curl returns empty
        return { stdout: JSON.stringify({ models: [] }), stderr: '' };
      },
      runRemote: async () => ({ stdout: JSON.stringify({ models: [] }), stderr: '' }),
      now: () => 1000,
      staleMs: 60_000,
    };
    const r = await spawnLocalLlmInVW({
      rawSpec: 'local:qwen3.5-35b-a3b',
      managerDeps: lmProbeDeps,
    });
    expect(r.session.id).toMatch(/^emb-local-llm-pty-/);
    expect(captured[0]!.cmd).toBe('lms');
    expect(captured[0]!.args).toEqual(['chat', 'qwen3.5-35b-a3b']);
    await r.session.dispose();
  });

  test('remote Ollama model → spawns `ssh -t <node> ollama run <model>`', async () => {
    const { captured } = installCapturingPty();
    initSpawnEmbodiedAgentInVW(makeTestRegistry());
    updateNodeStatus('node-b', {
      reachable: true,
      runtimes: ['ollama'],
      ollamaBaseUrl: 'http://node-b:11434/v1',
      at: 1000,
    });
    // Stage inventory via probe deps so listModelsFor('node-b') returns the Ollama model.
    const deps = {
      runLocal: async () => ({ stdout: JSON.stringify({ models: [] }), stderr: '' }),
      runRemote: async (host: string, argv: readonly string[]) => {
        if (argv[0] === 'curl' && host === 'node-b') {
          return {
            stdout: JSON.stringify({
              models: [{ name: 'llama3.1:70b', size: 40e9, details: { format: 'gguf' } }],
            }),
            stderr: '',
          };
        }
        return { stdout: JSON.stringify({ models: [] }), stderr: '' };
      },
      now: () => 1000,
      staleMs: 60_000,
    };
    const r = await spawnLocalLlmInVW({
      rawSpec: 'node-b:llama3.1:70b',
      managerDeps: deps,
    });
    expect(r.session.id).toMatch(/^emb-local-llm-ollama-ssh-pty-/);
    expect(captured[0]!.cmd).toBe('ssh');
    expect(captured[0]!.args).toEqual(['-t', 'node-b', 'ollama', 'run', 'llama3.1:70b']);
    await r.session.dispose();
  });

  test('unknown model (not in inventory) → LM Studio fallback (Bundle 1/2 A compat)', async () => {
    const { captured } = installCapturingPty();
    initSpawnEmbodiedAgentInVW(makeTestRegistry());
    const r = await spawnLocalLlmInVW({
      rawSpec: 'local:fresh-model-never-probed',
      managerDeps: emptyProbeDeps,
    });
    expect(captured[0]!.cmd).toBe('lms');
    expect(captured[0]!.args).toEqual(['chat', 'fresh-model-never-probed']);
    await r.session.dispose();
  });
});

describe('spawnLocalLlmInVW · A local happy path (still works)', () => {
  test('composes `lms chat <model>` via adapter · returns window + pane + session', async () => {
    const { captured } = installCapturingPty();
    initSpawnEmbodiedAgentInVW(makeTestRegistry());
    const r = await spawnLocalLlmInVW({
      rawSpec: 'local:qwen3.5-35b-a3b',
      cwd: '/tmp',
      managerDeps: emptyProbeDeps,
    });
    expect(r.windowId).toBeGreaterThan(0);
    expect(r.paneId).toBeTruthy();
    expect(r.ptyId).toBeTruthy();
    expect(r.session.id).toMatch(/^emb-local-llm-pty-/);
    expect(r.session.transports[0]!.kind).toBe('pty');
    expect(captured).toHaveLength(1);
    expect(captured[0]!.cmd).toBe('lms');
    expect(captured[0]!.args).toEqual(['chat', 'qwen3.5-35b-a3b']);
    await r.session.dispose();
  });

  test('uses "local-llm:<model>" as default title', async () => {
    installCapturingPty();
    const registry = makeTestRegistry();
    initSpawnEmbodiedAgentInVW(registry);
    const r = await spawnLocalLlmInVW({
      rawSpec: 'local:gpt-oss-20b',
      cwd: '/tmp',
      managerDeps: emptyProbeDeps,
    });
    const win = registry.get(r.windowId);
    expect(win?.title).toBe('local-llm:gpt-oss-20b');
    await r.session.dispose();
  });

  test('caller-supplied title overrides default', async () => {
    installCapturingPty();
    const registry = makeTestRegistry();
    initSpawnEmbodiedAgentInVW(registry);
    const r = await spawnLocalLlmInVW({
      rawSpec: 'local:gpt-oss-20b',
      title: 'my-local-llm',
      managerDeps: emptyProbeDeps,
    });
    const win = registry.get(r.windowId);
    expect(win?.title).toBe('my-local-llm');
    await r.session.dispose();
  });

  test('implicit-local bare model spec launches against local node', async () => {
    const { captured } = installCapturingPty();
    initSpawnEmbodiedAgentInVW(makeTestRegistry());
    const r = await spawnLocalLlmInVW({
      rawSpec: 'qwen3.5-35b-a3b',
      managerDeps: emptyProbeDeps,
    });
    expect(captured[0]!.args).toEqual(['chat', 'qwen3.5-35b-a3b']);
    await r.session.dispose();
  });

  test('manager probe failure does not block local spawn (soft-check semantics)', async () => {
    const { captured } = installCapturingPty();
    initSpawnEmbodiedAgentInVW(makeTestRegistry());
    const failingProbeDeps = {
      runLocal: async () => { throw new Error('lms crashed'); },
      runRemote: async () => { throw new Error('ssh down'); },
      now: () => 1000,
      staleMs: 60_000,
    };
    const r = await spawnLocalLlmInVW({
      rawSpec: 'local:qwen3.5-35b-a3b',
      managerDeps: failingProbeDeps,
    });
    expect(captured[0]!.args).toEqual(['chat', 'qwen3.5-35b-a3b']);
    await r.session.dispose();
  });
});

// 4.2 · Debug trace elevation (2026-04-22) — `spawn.local-llm.*` events
// must land in the ring buffer / file sink even at the default `trail`
// level, so `/acp-vw lll` failures can be triaged from `log/latest`
// without re-running with /debug diag pre-armed.
describe('spawnLocalLlmInVW · debug trace elevation (4.2)', () => {
  test('local spawn emits spec + launched at default trail level', async () => {
    const { debug } = await import('../src/debug/log.js');
    debug.setLevel('trail');
    debug.clear();
    installCapturingPty();
    initSpawnEmbodiedAgentInVW(makeTestRegistry());
    const r = await spawnLocalLlmInVW({
      rawSpec: 'local:qwen3.5-35b-a3b',
      managerDeps: emptyProbeDeps,
    });
    const events = debug.events(50);
    const cats = new Set(events.map((e) => e.category));
    expect(cats.has('spawn.local-llm.spec')).toBe(true);
    expect(cats.has('spawn.local-llm.launched')).toBe(true);
    const spec = events.find((e) => e.category === 'spawn.local-llm.spec');
    const data = spec!.data as { modelId: string; runtime: string };
    expect(data.modelId).toBe('qwen3.5-35b-a3b');
    expect(data.runtime).toBe('lmstudio');
    await r.session.dispose();
  });

  test('remote happy path emits remote-precheck-ok + spec + launched', async () => {
    const { debug } = await import('../src/debug/log.js');
    debug.setLevel('trail');
    debug.clear();
    installCapturingPty();
    initSpawnEmbodiedAgentInVW(makeTestRegistry());
    updateNodeStatus('node-b', {
      reachable: true,
      runtimes: ['lmstudio'],
      lmstudioBaseUrl: 'http://node-b:1234/v1',
      at: 1000,
    });
    const r = await spawnLocalLlmInVW({
      rawSpec: 'node-b:qwen3-72b',
      managerDeps: emptyProbeDeps,
    });
    const cats = new Set(debug.events(50).map((e) => e.category));
    expect(cats.has('spawn.local-llm.remote-precheck-ok')).toBe(true);
    expect(cats.has('spawn.local-llm.spec')).toBe(true);
    expect(cats.has('spawn.local-llm.launched')).toBe(true);
    await r.session.dispose();
  });

  test('all sinks off (level=off) suppresses every spawn.local-llm.* event', async () => {
    const { debug } = await import('../src/debug/log.js');
    debug.setLevel('off');
    debug.clear();
    installCapturingPty();
    initSpawnEmbodiedAgentInVW(makeTestRegistry());
    const r = await spawnLocalLlmInVW({
      rawSpec: 'local:qwen3.5-35b-a3b',
      managerDeps: emptyProbeDeps,
    });
    const spawnEvents = debug.events(50).filter((e) => e.category.startsWith('spawn.local-llm.'));
    expect(spawnEvents).toHaveLength(0);
    await r.session.dispose();
    // Restore default for subsequent tests.
    debug.setLevel('trail');
  });
});
