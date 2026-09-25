// H6 P2 Bundle 1 · lmstudio-probe tests (HTTP · fleet fixups 2026-04-22).
//
// Probe now hits `curl :1234/api/v0/models` (LM Studio extension)
// first, falling back to `curl :1234/v1/models` (OpenAI-compat) on
// HTTP 4xx (curl exit 22) for older LM Studio installs. The v0 path
// surfaces `state` / `capabilities` / `max_context_length` /
// `loaded_context_length` / `arch` / `quantization` / `publisher`
// fields that the v1 endpoint omits — needed for the wizard's
// loaded-vs-idle distinction and tool-use routing.
//
// Covered:
//   - v0 endpoint primary call (argv composition, local + remote)
//   - v0 → v1 fallback on curl exit 22 (older LM Studio)
//   - OpenAI-compat JSON parse (`data[].id`)
//   - v0 enrichment: loaded / capabilities / contextWindow / etc
//   - Error classification (daemon-down · cli-missing · parse-failed ·
//     unreachable · ssh-timeout · ssh-auth)
//   - Side effects on node-registry (reachable · lmstudioBaseUrl ·
//     runtimes=['lmstudio'] on success)

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  probeLmstudio,
  classifyProbeError,
} from '../src/llm/local-manager/lmstudio-probe.js';
import {
  _getNodeStatusForTesting,
  _resetNodeStatusForTesting,
} from '../src/llm/local-manager/node-registry.js';

beforeEach(() => {
  _resetNodeStatusForTesting();
});

/** Helper for OpenAI-compat /v1/models response shape. */
function modelsJson(ids: readonly string[]): string {
  return JSON.stringify({
    object: 'list',
    data: ids.map((id) => ({ id, object: 'model' })),
  });
}

describe('probeLmstudio · local', () => {
  test('parses OpenAI-compat data[] into models · updates node-registry', async () => {
    const r = await probeLmstudio(
      { id: 'local', isLocal: true },
      {
        runLocal: async () => ({
          stdout: modelsJson([
            'lmstudio-community/qwen2.5-32b-instruct-mlx',
            'lmstudio-community/gpt-oss-20b-gguf',
          ]),
          stderr: '',
        }),
        now: () => 42,
      },
    );
    expect(r.reachable).toBe(true);
    expect(r.runtime).toBe('lmstudio');
    expect(r.models).toHaveLength(2);
    expect(r.models[0]!.id).toBe('lmstudio-community/qwen2.5-32b-instruct-mlx');
    expect(r.models[0]!.label).toBe('qwen2.5-32b-instruct-mlx');
    expect(r.models[1]!.id).toBe('lmstudio-community/gpt-oss-20b-gguf');
    expect(r.baseUrl).toBe('http://localhost:1234/v1');
    expect(r.warnings).toEqual([]);
    const st = _getNodeStatusForTesting('local')!;
    expect(st.reachable).toBe(true);
    expect(st.runtimes).toEqual(['lmstudio']);
    expect(st.lmstudioBaseUrl).toBe('http://localhost:1234/v1');
  });

  test('deduplicates repeated model ids in response', async () => {
    const r = await probeLmstudio(
      { id: 'local', isLocal: true },
      {
        runLocal: async () => ({
          stdout: modelsJson(['dup', 'dup', 'unique']),
          stderr: '',
        }),
        now: () => 1,
      },
    );
    expect(r.models).toHaveLength(2);
    expect(r.models.map((m) => m.id).sort()).toEqual(['dup', 'unique']);
  });

  test('skips entries with empty or missing id', async () => {
    const r = await probeLmstudio(
      { id: 'local', isLocal: true },
      {
        runLocal: async () => ({
          stdout: JSON.stringify({ data: [{ id: '' }, { id: '   ' }, {}, { id: 'real-model' }] }),
          stderr: '',
        }),
        now: () => 1,
      },
    );
    expect(r.models).toHaveLength(1);
    expect(r.models[0]!.id).toBe('real-model');
  });

  test('daemon down (curl exit 7 · connection refused) classifies as daemon-down', async () => {
    const r = await probeLmstudio(
      { id: 'local', isLocal: true },
      {
        runLocal: async () => { throw new Error('curl exited 7 · stderr=Failed to connect'); },
        now: () => 1,
      },
    );
    expect(r.reachable).toBe(false);
    expect(r.models).toEqual([]);
    expect(r.warnings).toContain('daemon-down');
  });

  test('curl missing (command not found) classifies as cli-missing', async () => {
    const r = await probeLmstudio(
      { id: 'local', isLocal: true },
      {
        runLocal: async () => { throw new Error('spawn curl ENOENT: command not found'); },
        now: () => 1,
      },
    );
    expect(r.reachable).toBe(false);
    expect(r.warnings).toContain('cli-missing');
  });

  test('parse failure falls to empty models + warning', async () => {
    const r = await probeLmstudio(
      { id: 'local', isLocal: true },
      { runLocal: async () => ({ stdout: 'not json', stderr: '' }), now: () => 1 },
    );
    expect(r.reachable).toBe(true); // curl worked · parse failed
    expect(r.models).toEqual([]);
    expect(r.warnings).toContain('parse-failed');
  });

  test('empty data array emits no-models warning', async () => {
    const r = await probeLmstudio(
      { id: 'local', isLocal: true },
      { runLocal: async () => ({ stdout: JSON.stringify({ data: [] }), stderr: '' }), now: () => 1 },
    );
    expect(r.reachable).toBe(true);
    expect(r.models).toEqual([]);
    expect(r.warnings).toContain('no-models');
  });

  test('passes curl argv through runLocal with --max-time half the timeout', async () => {
    let seenArgv: readonly string[] | undefined;
    await probeLmstudio(
      { id: 'local', isLocal: true },
      {
        runLocal: async (argv) => {
          seenArgv = argv;
          return { stdout: modelsJson([]), stderr: '' };
        },
        timeoutMs: 10_000,
        now: () => 1,
      },
    );
    expect(seenArgv).toBeDefined();
    expect(seenArgv![0]).toBe('curl');
    expect(seenArgv).toContain('-sf');
    expect(seenArgv).toContain('--max-time');
    expect(seenArgv).toContain('5');
    // Probe defaults to LM Studio's v0 extension endpoint (richer
    // payload). The /v1/models OpenAI-compat fallback only fires when
    // v0 returns HTTP 404 (curl exit 22) — covered separately below.
    expect(seenArgv).toContain('http://127.0.0.1:1234/api/v0/models');
  });

  test('falls back to /v1/models when v0 returns HTTP 4xx (curl exit 22)', async () => {
    const seenArgvs: string[][] = [];
    const r = await probeLmstudio(
      { id: 'local', isLocal: true },
      {
        runLocal: async (argv) => {
          seenArgvs.push([...argv]);
          // First call (v0) → simulate 404 / older LM Studio
          if (argv[argv.length - 1]!.endsWith('/api/v0/models')) {
            throw new Error('curl exited 22 · stderr=The requested URL returned error: 404');
          }
          // Second call (/v1/models) → succeeds with legacy shape
          return { stdout: modelsJson(['legacy-model']), stderr: '' };
        },
        now: () => 99,
      },
    );
    expect(seenArgvs).toHaveLength(2);
    expect(seenArgvs[0]![seenArgvs[0]!.length - 1]).toBe('http://127.0.0.1:1234/api/v0/models');
    expect(seenArgvs[1]![seenArgvs[1]!.length - 1]).toBe('http://127.0.0.1:1234/v1/models');
    expect(r.reachable).toBe(true);
    expect(r.models).toHaveLength(1);
    expect(r.models[0]!.id).toBe('legacy-model');
    // Legacy /v1 shape carries no enrichment fields → all undefined.
    expect(r.models[0]!.loaded).toBeUndefined();
    expect(r.models[0]!.capabilities).toBeUndefined();
    expect(r.models[0]!.contextWindow).toBeUndefined();
  });

  test('parses v0 enrichment fields (state, capabilities, context, arch, quantization)', async () => {
    const v0Body = JSON.stringify({
      data: [
        {
          id: 'qwen3.6-35b-a3b-ud-mlx',
          object: 'model',
          type: 'vlm',
          publisher: 'unsloth',
          arch: 'qwen3_5_moe',
          compatibility_type: 'mlx',
          quantization: '4bit',
          state: 'loaded',
          max_context_length: 262144,
          loaded_context_length: 136650,
          capabilities: ['tool_use'],
        },
        {
          id: 'gemma-4-26b-a4b',
          object: 'model',
          type: 'vlm',
          publisher: 'mlx-community',
          arch: 'gemma4',
          compatibility_type: 'mlx',
          quantization: '4bit',
          state: 'not-loaded',
          max_context_length: 262144,
          capabilities: ['tool_use'],
        },
      ],
    });
    const r = await probeLmstudio(
      { id: 'local', isLocal: true },
      { runLocal: async () => ({ stdout: v0Body, stderr: '' }), now: () => 5 },
    );
    expect(r.reachable).toBe(true);
    expect(r.models).toHaveLength(2);
    const qwen = r.models[0]!;
    expect(qwen.loaded).toBe(true);
    expect(qwen.capabilities).toEqual(['tool_use']);
    expect(qwen.contextWindow).toBe(262144);
    expect(qwen.loadedContextWindow).toBe(136650);
    expect(qwen.arch).toBe('qwen3_5_moe');
    expect(qwen.quantization).toBe('4bit');
    expect(qwen.publisher).toBe('unsloth');
    expect(qwen.format).toBe('mlx');
    const gemma = r.models[1]!;
    expect(gemma.loaded).toBe(false);
    expect(gemma.loadedContextWindow).toBeUndefined();
  });
});

describe('probeLmstudio · remote', () => {
  test('invokes runRemote with ssh host + user', async () => {
    let capturedHost = '';
    let capturedUser: string | undefined;
    const r = await probeLmstudio(
      { id: 'node-b', isLocal: false, sshHost: 'node-b', sshUser: 'user' },
      {
        runRemote: async (host, _argv, opts) => {
          capturedHost = host;
          capturedUser = opts.user;
          return { stdout: modelsJson(['qwen3.5-9b-mlx']), stderr: '' };
        },
        now: () => 7,
      },
    );
    expect(capturedHost).toBe('node-b');
    expect(capturedUser).toBe('user');
    expect(r.reachable).toBe(true);
    expect(r.models[0]!.id).toBe('qwen3.5-9b-mlx');
    expect(r.baseUrl).toBe('http://node-b:1234/v1');
  });

  test('missing sshHost returns failure with missing-ssh-host', async () => {
    const r = await probeLmstudio(
      { id: 'orphan', isLocal: false },
      { now: () => 1 },
    );
    expect(r.reachable).toBe(false);
    expect(r.warnings).toContain('missing-ssh-host');
  });

  test('ssh timeout classifies as ssh-timeout', async () => {
    const r = await probeLmstudio(
      { id: 'mbp', isLocal: false, sshHost: 'mbp' },
      {
        runRemote: async () => { throw new Error('probe timeout after 15000ms'); },
        now: () => 1,
      },
    );
    expect(r.warnings).toContain('ssh-timeout');
  });

  test('SSH-level connection refused → daemon-down (shared taxonomy)', async () => {
    const r = await probeLmstudio(
      { id: 'mbp', isLocal: false, sshHost: 'mbp' },
      {
        runRemote: async () => { throw new Error('ssh: connect to host mbp port 22: Connection refused'); },
        now: () => 1,
      },
    );
    expect(r.warnings).toContain('daemon-down');
  });

  test('permission denied → ssh-auth', async () => {
    const r = await probeLmstudio(
      { id: 'mbp', isLocal: false, sshHost: 'mbp' },
      {
        runRemote: async () => { throw new Error('Permission denied (publickey).'); },
        now: () => 1,
      },
    );
    expect(r.warnings).toContain('ssh-auth');
  });
});

describe('classifyProbeError', () => {
  test('daemon-down for connection refused · curl exit 7', () => {
    expect(classifyProbeError('connection refused on port 1234')).toBe('daemon-down');
    expect(classifyProbeError('curl exited 7 · stderr=Failed to connect')).toBe('daemon-down');
  });

  test('ssh-timeout for timeout · curl exit 28', () => {
    expect(classifyProbeError('probe timeout after 15000ms')).toBe('ssh-timeout');
    expect(classifyProbeError('curl exited 28 · stderr=timed out')).toBe('ssh-timeout');
  });

  test('unreachable for no route · curl exit 6 (DNS)', () => {
    expect(classifyProbeError('ssh: no route to host')).toBe('unreachable');
    expect(classifyProbeError('curl exited 6 · stderr=Could not resolve')).toBe('unreachable');
  });

  test('cli-missing for command not found', () => {
    expect(classifyProbeError('spawn curl ENOENT: command not found')).toBe('cli-missing');
  });

  test('ssh-auth for permission denied', () => {
    expect(classifyProbeError('Permission denied (publickey).')).toBe('ssh-auth');
  });

  test('probe-error for uncategorized', () => {
    expect(classifyProbeError('some unexpected error')).toBe('probe-error');
  });
});
