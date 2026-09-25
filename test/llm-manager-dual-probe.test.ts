// H6 P2 Bundle 2 C1 · Manager dual-probe (lmstudio + ollama) tests.
// Bundle 2 C2+C3 · extended to quad-probe (adds MLX + Docker). The
// same convergence rule (union runtimes · OR-reachable · preserve
// per-runtime baseUrls) applies with 4 probes instead of 2. The
// single-runtime fakes (lms/curl) below still exercise the dual-probe
// path because MLX also uses curl — the canned stdout therefore feeds
// BOTH ollama and mlx from the same fake when `localOll`/`localLms`
// aren't distinguished. Quad-probe specific behavior (4 runtimes
// union · MLX/Docker baseUrls) lives in the `quad-probe` describe
// block at the bottom of this file.
//
// Covers:
//   - refreshInventory runs all four probes in parallel per node ·
//     models from each runtime appear in the aggregated inventory
//   - warnings prefixed `<nodeId>:<runtime>:<warning>` (all four
//     probes surface failures independently)
//   - updateNodeStatus final aggregated write converges runtimes union
//     + reachable=true iff ANY probe succeeded
//   - resolveBaseUrl runtime-aware: Ollama → ollamaBaseUrl · MLX →
//     mlxBaseUrl · Docker → dockerBaseUrl · LM Studio → lmstudioBaseUrl
//     · unknown model → LM Studio fallback for Bundle 1 compat

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  refreshInventory,
  resolveBaseUrl,
  listAllModels,
  listModelsFor,
  _resetManagerForTesting,
} from '../src/llm/local-manager/manager.js';
import { _resetSshHostsForTesting, setSshHostsForTesting } from '../src/ssh/ssh-hosts.js';
import { TEST_FLEET } from './fixtures/ssh-fleet.js';

beforeEach(() => {
  _resetManagerForTesting();
  _resetSshHostsForTesting();
  setSshHostsForTesting(TEST_FLEET);
});

function emptyLms() { return JSON.stringify({ object: 'list', data: [] }); }
function emptyOll() { return JSON.stringify({ models: [] }); }

function lmsJson(ids: readonly string[]): string {
  return JSON.stringify({
    object: 'list',
    data: ids.map((id) => ({ id, object: 'model' })),
  });
}

function ollJson(ids: readonly string[]): string {
  return JSON.stringify({
    models: ids.map((id) => ({ name: id, size: 2000, details: { format: 'gguf' } })),
  });
}

/** Inject runLocal/runRemote that dispatch per-probe. Fleet fixups
 *  2026-04-22: LM Studio moved from `lms` CLI to HTTP `:1234/v1/models`
 *  so every runtime except docker now goes through `curl`. Dispatch
 *  is URL-port based:
 *    - curl :1234 → lmstudio
 *    - curl :11434 → ollama
 *    - curl :8080 → mlx
 *    - docker binary → docker
 *  Unspecified mlx/docker fakes default to `daemon-down` to model the
 *  common real state (user hasn't launched `mlx_lm.server` or Docker
 *  isn't running). */
function dualRunners(opts: {
  localLms?: string;
  localOll?: string;
  localMlx?: string;
  localDocker?: string;
  remoteLms?: (host: string) => string;
  remoteOll?: (host: string) => string;
  remoteMlx?: (host: string) => string;
  remoteDocker?: (host: string) => string;
  localLmsThrow?: string;
  localOllThrow?: string;
  localMlxThrow?: string;
  localDockerThrow?: string;
  remoteLmsThrow?: (host: string) => string | undefined;
  remoteOllThrow?: (host: string) => string | undefined;
  remoteMlxThrow?: (host: string) => string | undefined;
  remoteDockerThrow?: (host: string) => string | undefined;
}) {
  const MLX_DEFAULT_THROW = 'curl exited 7 · connection refused';
  const DOCKER_DEFAULT_THROW = 'Cannot connect to the Docker daemon';
  const curlKind = (argv: readonly string[]): 'lms' | 'oll' | 'mlx' | null => {
    if (argv[0] !== 'curl') return null;
    // Match LM Studio probe URL on either the v0 extension endpoint
    // (primary, post-2026-05-05) or the v1 OpenAI-compat endpoint
    // (fallback for older LM Studio installs). The test mocks return
    // the same `data: [{id}]` shape from both paths — the runtime
    // probe accepts both seamlessly because the v0 endpoint extends
    // (rather than replaces) the v1 wire format.
    if (argv.some((a) => a.includes(':1234/api/v0/models')
      || a.includes(':1234/v1/models'))) return 'lms';
    if (argv.some((a) => a.includes(':11434/api/tags'))) return 'oll';
    if (argv.some((a) => a.includes(':8080/v1/models'))) return 'mlx';
    return null;
  };
  return {
    runLocal: async (argv: readonly string[]) => {
      if (argv[0] === 'docker') {
        if (opts.localDockerThrow) throw new Error(opts.localDockerThrow);
        if (opts.localDocker === undefined) throw new Error(DOCKER_DEFAULT_THROW);
        return { stdout: opts.localDocker, stderr: '' };
      }
      const kind = curlKind(argv);
      if (kind === 'lms') {
        if (opts.localLmsThrow) throw new Error(opts.localLmsThrow);
        return { stdout: opts.localLms ?? emptyLms(), stderr: '' };
      }
      if (kind === 'mlx') {
        if (opts.localMlxThrow) throw new Error(opts.localMlxThrow);
        if (opts.localMlx === undefined) throw new Error(MLX_DEFAULT_THROW);
        return { stdout: opts.localMlx, stderr: '' };
      }
      // ollama (kind === 'oll' or null fallback)
      if (opts.localOllThrow) throw new Error(opts.localOllThrow);
      return { stdout: opts.localOll ?? emptyOll(), stderr: '' };
    },
    runRemote: async (host: string, argv: readonly string[]) => {
      if (argv[0] === 'docker') {
        const t = opts.remoteDockerThrow?.(host);
        if (t) throw new Error(t);
        const canned = opts.remoteDocker?.(host);
        if (canned === undefined) throw new Error(DOCKER_DEFAULT_THROW);
        return { stdout: canned, stderr: '' };
      }
      const kind = curlKind(argv);
      if (kind === 'lms') {
        const t = opts.remoteLmsThrow?.(host);
        if (t) throw new Error(t);
        return { stdout: opts.remoteLms?.(host) ?? emptyLms(), stderr: '' };
      }
      if (kind === 'mlx') {
        const t = opts.remoteMlxThrow?.(host);
        if (t) throw new Error(t);
        const canned = opts.remoteMlx?.(host);
        if (canned === undefined) throw new Error(MLX_DEFAULT_THROW);
        return { stdout: canned, stderr: '' };
      }
      const t = opts.remoteOllThrow?.(host);
      if (t) throw new Error(t);
      return { stdout: opts.remoteOll?.(host) ?? emptyOll(), stderr: '' };
    },
  };
}

/** Helper for docker ps JSON-per-line stdout. */
function dockerPsStdout(rows: readonly {
  name: string;
  image: string;
  ports?: string;
}[]): string {
  return rows
    .map((r) => JSON.stringify({
      ID: r.name,
      Names: r.name,
      Image: r.image,
      Ports: r.ports ?? '',
      State: 'running',
      Status: 'Up',
    }))
    .join('\n');
}

/** Helper for MLX /v1/models JSON. */
function mlxJson(ids: readonly string[]): string {
  return JSON.stringify({
    object: 'list',
    data: ids.map((id) => ({ id, object: 'model' })),
  });
}

describe('manager · dual-probe refreshInventory', () => {
  test('both probes run per node · models aggregated from both runtimes', async () => {
    const inv = await refreshInventory({
      ...dualRunners({
        localLms: lmsJson(['lms-model-a']),
        localOll: ollJson(['llama3.1:8b']),
        remoteLms: (h) => (h === 'mbp' ? lmsJson(['qwen-72b']) : emptyLms()),
        remoteOll: (h) => (h === 'node-b' ? ollJson(['deepseek-r1:70b']) : emptyOll()),
      }),
      now: () => 1,
    });
    const ids = listAllModels().map((m) => `${m.nodeId}/${m.runtime}/${m.id}`);
    expect(ids).toContain('local/lmstudio/lms-model-a');
    expect(ids).toContain('local/ollama/llama3.1:8b');
    expect(ids).toContain('mbp/lmstudio/qwen-72b');
    expect(ids).toContain('node-b/ollama/deepseek-r1:70b');
    // Nodes with empty stdout get `no-models` warnings — that's expected
    // when probes succeed but find nothing (e.g. mba/minio/node-c in this
    // canned fixture). Assert that the NODES WE POPULATED have no
    // warnings for their respective runtimes.
    expect(inv.warnings.some((w) => w === 'local:lmstudio:no-models')).toBe(false);
    expect(inv.warnings.some((w) => w === 'local:ollama:no-models')).toBe(false);
    expect(inv.warnings.some((w) => w === 'mbp:lmstudio:no-models')).toBe(false);
    expect(inv.warnings.some((w) => w === 'node-b:ollama:no-models')).toBe(false);
  });

  test('local node runtimes union contains both lmstudio and ollama on dual success', async () => {
    const inv = await refreshInventory({
      ...dualRunners({
        localLms: lmsJson(['m1']),
        localOll: ollJson(['llama3.1:8b']),
      }),
      now: () => 1,
    });
    const local = inv.nodes.find((n) => n.id === 'local')!;
    expect(local.reachable).toBe(true);
    expect(local.runtimes).toContain('lmstudio');
    expect(local.runtimes).toContain('ollama');
    expect(local.lmstudioBaseUrl).toBe('http://localhost:1234/v1');
    expect(local.ollamaBaseUrl).toBe('http://localhost:11434/v1');
  });

  test('reachable=true when only one runtime succeeds (lmstudio only)', async () => {
    const inv = await refreshInventory({
      ...dualRunners({
        localLms: lmsJson(['m1']),
        localOllThrow: 'curl exited 7 · connection refused',
      }),
      now: () => 1,
    });
    const local = inv.nodes.find((n) => n.id === 'local')!;
    expect(local.reachable).toBe(true);
    expect(local.runtimes).toEqual(['lmstudio']);
    expect(inv.warnings.some((w) => w === 'local:ollama:daemon-down')).toBe(true);
  });

  test('reachable=true when only ollama succeeds', async () => {
    const inv = await refreshInventory({
      ...dualRunners({
        localLmsThrow: 'spawn lms ENOENT: command not found',
        localOll: ollJson(['llama3.1:8b']),
      }),
      now: () => 1,
    });
    const local = inv.nodes.find((n) => n.id === 'local')!;
    expect(local.reachable).toBe(true);
    expect(local.runtimes).toEqual(['ollama']);
    expect(inv.warnings.some((w) => w === 'local:lmstudio:cli-missing')).toBe(true);
  });

  test('reachable=false when both probes fail', async () => {
    const inv = await refreshInventory({
      ...dualRunners({
        localLmsThrow: 'spawn lms ENOENT: command not found',
        localOllThrow: 'curl exited 7 · connection refused',
      }),
      now: () => 1,
    });
    const local = inv.nodes.find((n) => n.id === 'local')!;
    expect(local.reachable).toBe(false);
    expect(local.runtimes).toEqual([]);
    expect(inv.warnings).toContain('local:lmstudio:cli-missing');
    expect(inv.warnings).toContain('local:ollama:daemon-down');
  });

  test('both runtimes on node-b · both baseUrls populated', async () => {
    const inv = await refreshInventory({
      ...dualRunners({
        remoteLms: () => lmsJson(['qwen-72b']),
        remoteOll: () => ollJson(['llama3.1:70b']),
      }),
      now: () => 1,
    });
    const nodeB = inv.nodes.find((n) => n.id === 'node-b')!;
    expect(nodeB.reachable).toBe(true);
    expect(nodeB.runtimes.sort()).toEqual(['lmstudio', 'ollama']);
    expect(nodeB.lmstudioBaseUrl).toBe('http://node-b:1234/v1');
    expect(nodeB.ollamaBaseUrl).toBe('http://node-b:11434/v1');
  });
});

describe('manager · resolveBaseUrl (Bundle 2 C1 · runtime-aware)', () => {
  test('Ollama model resolves to ollamaBaseUrl', async () => {
    await refreshInventory({
      ...dualRunners({
        localLms: lmsJson(['lms-m']),
        localOll: ollJson(['llama3.1:8b']),
      }),
      now: () => 1,
    });
    expect(resolveBaseUrl('local', 'llama3.1:8b')).toBe('http://localhost:11434/v1');
  });

  test('LM Studio model resolves to lmstudioBaseUrl', async () => {
    await refreshInventory({
      ...dualRunners({
        localLms: lmsJson(['lms-m']),
        localOll: ollJson(['llama3.1:8b']),
      }),
      now: () => 1,
    });
    expect(resolveBaseUrl('local', 'lms-m')).toBe('http://localhost:1234/v1');
  });

  test('unknown model falls back to lmstudioBaseUrl (Bundle 1 compat)', async () => {
    await refreshInventory({
      ...dualRunners({
        localLms: lmsJson(['lms-m']),
        localOll: ollJson(['llama3.1:8b']),
      }),
      now: () => 1,
    });
    expect(resolveBaseUrl('local', 'unknown-model-xyz')).toBe('http://localhost:1234/v1');
  });

  test('unknown model falls back to ollamaBaseUrl when LM Studio absent', async () => {
    await refreshInventory({
      ...dualRunners({
        localLmsThrow: 'spawn lms ENOENT: command not found',
        localOll: ollJson(['llama3.1:8b']),
      }),
      now: () => 1,
    });
    expect(resolveBaseUrl('local', 'unknown-model-xyz')).toBe('http://localhost:11434/v1');
  });

  test('remote node · Ollama model uses remote Ollama URL', async () => {
    await refreshInventory({
      ...dualRunners({
        remoteOll: (h) => (h === 'node-b' ? ollJson(['deepseek-r1:70b']) : emptyOll()),
      }),
      now: () => 1,
    });
    expect(resolveBaseUrl('node-b', 'deepseek-r1:70b')).toBe('http://node-b:11434/v1');
  });

  test('unreachable node returns null regardless of model', async () => {
    await refreshInventory({
      ...dualRunners({
        remoteLmsThrow: () => 'connection refused',
        remoteOllThrow: () => 'connection refused',
      }),
      now: () => 1,
    });
    expect(resolveBaseUrl('node-b', 'some-model')).toBeNull();
  });
});

describe('manager · listModelsFor (dual runtime)', () => {
  test('returns models from both runtimes on the same node', async () => {
    await refreshInventory({
      ...dualRunners({
        localLms: lmsJson(['lms-m']),
        localOll: ollJson(['llama3.1:8b', 'qwen2.5:7b']),
      }),
      now: () => 1,
    });
    const local = listModelsFor('local');
    expect(local).toHaveLength(3);
    const byRuntime = new Map<string, string[]>();
    for (const m of local) {
      const list = byRuntime.get(m.runtime) ?? [];
      list.push(m.id);
      byRuntime.set(m.runtime, list);
    }
    expect(byRuntime.get('lmstudio')).toEqual(['lms-m']);
    expect(byRuntime.get('ollama')?.sort()).toEqual(['llama3.1:8b', 'qwen2.5:7b']);
  });
});

describe('manager · quad-probe (Bundle 2 C2+C3)', () => {
  test('all four probes run in parallel · union runtimes on success', async () => {
    const inv = await refreshInventory({
      ...dualRunners({
        localLms: lmsJson(['lms-m']),
        localOll: ollJson(['llama3.1:8b']),
        localMlx: mlxJson(['mlx-community/Qwen2.5-32B-4bit']),
        localDocker: dockerPsStdout([
          { name: 'vllm-qwen', image: 'vllm/vllm-openai:latest', ports: '0.0.0.0:8000->8000/tcp' },
        ]),
      }),
      now: () => 1,
    });
    const local = inv.nodes.find((n) => n.id === 'local')!;
    expect(local.reachable).toBe(true);
    expect(local.runtimes.sort()).toEqual(['docker', 'lmstudio', 'mlx', 'ollama']);
    expect(local.lmstudioBaseUrl).toBe('http://localhost:1234/v1');
    expect(local.ollamaBaseUrl).toBe('http://localhost:11434/v1');
    expect(local.mlxBaseUrl).toBe('http://localhost:8080/v1');
    expect(local.dockerBaseUrl).toBe('http://localhost:8000/v1');
  });

  test('MLX reachable alone · daemon-down for others · single-runtime', async () => {
    const inv = await refreshInventory({
      ...dualRunners({
        localLmsThrow: 'spawn lms ENOENT: command not found',
        localOllThrow: 'curl exited 7 · connection refused',
        localMlx: mlxJson(['mlx-community/Llama-3.1-8B-4bit']),
        // docker defaults to daemon-down throw
      }),
      now: () => 1,
    });
    const local = inv.nodes.find((n) => n.id === 'local')!;
    expect(local.reachable).toBe(true);
    expect(local.runtimes).toEqual(['mlx']);
    expect(inv.warnings).toContain('local:lmstudio:cli-missing');
    expect(inv.warnings).toContain('local:ollama:daemon-down');
    expect(inv.warnings).toContain('local:docker:daemon-down');
  });

  test('Docker containers aggregated as models · non-LLM images excluded', async () => {
    const inv = await refreshInventory({
      ...dualRunners({
        localDocker: dockerPsStdout([
          { name: 'pg', image: 'postgres:16', ports: '0.0.0.0:5432->5432/tcp' },
          { name: 'tgi-x', image: 'ghcr.io/huggingface/text-generation-inference:latest', ports: '0.0.0.0:3000->80/tcp' },
        ]),
      }),
      now: () => 1,
    });
    const dockerModels = listAllModels().filter((m) => m.runtime === 'docker');
    expect(dockerModels).toHaveLength(1);
    expect(dockerModels[0]!.id).toContain('text-generation-inference');
  });

  test('resolveBaseUrl · MLX model resolves to mlxBaseUrl', async () => {
    await refreshInventory({
      ...dualRunners({
        localMlx: mlxJson(['mlx-community/Qwen2.5-7B-4bit']),
      }),
      now: () => 1,
    });
    expect(resolveBaseUrl('local', 'mlx-community/Qwen2.5-7B-4bit'))
      .toBe('http://localhost:8080/v1');
  });

  test('resolveBaseUrl · Docker model resolves to dockerBaseUrl', async () => {
    await refreshInventory({
      ...dualRunners({
        localDocker: dockerPsStdout([
          { name: 'vllm', image: 'vllm/vllm-openai:latest', ports: '0.0.0.0:8000->8000/tcp' },
        ]),
      }),
      now: () => 1,
    });
    const dockerModel = listAllModels().find((m) => m.runtime === 'docker');
    expect(dockerModel).toBeDefined();
    expect(resolveBaseUrl('local', dockerModel!.id)).toBe('http://localhost:8000/v1');
  });

  test('resolveBaseUrl · unknown model falls back to lmstudio → ollama → mlx → docker', async () => {
    // lmstudio absent · ollama absent · mlx reachable · docker absent
    await refreshInventory({
      ...dualRunners({
        localLmsThrow: 'spawn lms ENOENT',
        localOllThrow: 'curl exited 7',
        localMlx: mlxJson(['some-mlx-model']),
      }),
      now: () => 1,
    });
    // Unknown model · LM Studio + Ollama missing · MLX wins the fallback.
    expect(resolveBaseUrl('local', 'ghost-model')).toBe('http://localhost:8080/v1');
  });

  test('warnings are prefixed per-runtime for all four probes', async () => {
    const inv = await refreshInventory({
      ...dualRunners({
        localLmsThrow: 'spawn lms ENOENT: command not found',
        localOllThrow: 'curl exited 7 · connection refused',
        localMlxThrow: 'curl exited 7 · connection refused',
        localDockerThrow: 'Cannot connect to the Docker daemon',
      }),
      now: () => 1,
    });
    expect(inv.warnings).toContain('local:lmstudio:cli-missing');
    expect(inv.warnings).toContain('local:ollama:daemon-down');
    expect(inv.warnings).toContain('local:mlx:daemon-down');
    expect(inv.warnings).toContain('local:docker:daemon-down');
  });
});
