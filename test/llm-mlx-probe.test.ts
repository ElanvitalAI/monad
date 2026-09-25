// H6 P2 Bundle 2 C2 · MLX HTTP probe tests.
//
// Mirrors test/llm-ollama-probe.test.ts. Covers:
//   - curl arg composition (local + remote via runLocal/runRemote fakes)
//   - OpenAI-compat JSON parsing (`data[].id`)
//   - Error classification (daemon-down · cli-missing · parse-failed ·
//     unreachable · ssh-timeout · ssh-auth)
//   - Side effects on node-registry (reachable · mlxBaseUrl ·
//     runtimes=['mlx'] on success)

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  probeMlx,
  classifyMlxProbeError,
} from '../src/llm/local-manager/mlx-probe.js';
import {
  _getNodeStatusForTesting,
  _resetNodeStatusForTesting,
} from '../src/llm/local-manager/node-registry.js';

beforeEach(() => {
  _resetNodeStatusForTesting();
});

describe('probeMlx · local node', () => {
  test('success · parses data[].id · populates status cache', async () => {
    const json = JSON.stringify({
      object: 'list',
      data: [
        { id: 'mlx-community/Qwen2.5-32B-Instruct-4bit', object: 'model' },
        { id: 'mlx-community/Llama-3.1-70B-Instruct-8bit', object: 'model' },
      ],
    });
    const r = await probeMlx(
      { id: 'local', isLocal: true },
      {
        runLocal: async () => ({ stdout: json, stderr: '' }),
        now: () => 1000,
      },
    );
    expect(r.reachable).toBe(true);
    expect(r.runtime).toBe('mlx');
    expect(r.models).toHaveLength(2);
    expect(r.models[0]!.id).toBe('mlx-community/Qwen2.5-32B-Instruct-4bit');
    expect(r.models[0]!.runtime).toBe('mlx');
    expect(r.models[0]!.format).toBe('mlx');
    expect(r.baseUrl).toBe('http://localhost:8080/v1');
    expect(r.warnings).toEqual([]);
    const status = _getNodeStatusForTesting('local');
    expect(status?.reachable).toBe(true);
    expect(status?.runtimes).toEqual(['mlx']);
    expect(status?.mlxBaseUrl).toBe('http://localhost:8080/v1');
  });

  test('empty data[] → reachable + no-models warning', async () => {
    const r = await probeMlx(
      { id: 'local', isLocal: true },
      {
        runLocal: async () => ({ stdout: JSON.stringify({ data: [] }), stderr: '' }),
        now: () => 1000,
      },
    );
    expect(r.reachable).toBe(true);
    expect(r.warnings).toEqual(['no-models']);
    expect(r.models).toEqual([]);
  });

  test('server down (curl exit 7 · connection refused) classified', async () => {
    const r = await probeMlx(
      { id: 'local', isLocal: true },
      {
        runLocal: async () => { throw new Error('curl exited 7 · stderr=connection refused'); },
        now: () => 1000,
      },
    );
    expect(r.reachable).toBe(false);
    expect(r.warnings).toEqual(['daemon-down']);
    expect(r.models).toEqual([]);
  });

  test('curl missing (command not found) classified', async () => {
    const r = await probeMlx(
      { id: 'local', isLocal: true },
      {
        runLocal: async () => { throw new Error('spawn curl ENOENT: command not found'); },
        now: () => 1000,
      },
    );
    expect(r.warnings).toEqual(['cli-missing']);
  });

  test('malformed JSON → reachable but parse-failed warning', async () => {
    const r = await probeMlx(
      { id: 'local', isLocal: true },
      {
        runLocal: async () => ({ stdout: '<html>Not Found</html>', stderr: '' }),
        now: () => 1000,
      },
    );
    expect(r.reachable).toBe(true);
    expect(r.warnings).toContain('parse-failed');
    expect(r.models).toEqual([]);
  });

  test('uses spawn-timeout message as ssh-timeout', async () => {
    const r = await probeMlx(
      { id: 'local', isLocal: true },
      {
        runLocal: async () => { throw new Error('probe timeout after 15000ms'); },
        now: () => 1000,
      },
    );
    expect(r.warnings).toEqual(['ssh-timeout']);
  });

  test('passes curl argv through runLocal with --max-time half the timeout', async () => {
    let seenArgv: readonly string[] | undefined;
    await probeMlx(
      { id: 'local', isLocal: true },
      {
        runLocal: async (argv) => {
          seenArgv = argv;
          return { stdout: JSON.stringify({ data: [] }), stderr: '' };
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
    expect(seenArgv).toContain('http://127.0.0.1:8080/v1/models');
  });

  test('dedupes repeated model ids in the response', async () => {
    const json = JSON.stringify({
      data: [
        { id: 'dup-model' },
        { id: 'dup-model' },
        { id: 'unique-model' },
      ],
    });
    const r = await probeMlx(
      { id: 'local', isLocal: true },
      {
        runLocal: async () => ({ stdout: json, stderr: '' }),
        now: () => 1,
      },
    );
    expect(r.models).toHaveLength(2);
    expect(r.models.map((m) => m.id).sort()).toEqual(['dup-model', 'unique-model']);
  });

  test('skips entries with empty or missing id', async () => {
    const json = JSON.stringify({
      data: [
        { id: '' },
        { id: '   ' },
        {},
        { id: 'real-model' },
      ],
    });
    const r = await probeMlx(
      { id: 'local', isLocal: true },
      {
        runLocal: async () => ({ stdout: json, stderr: '' }),
        now: () => 1,
      },
    );
    expect(r.models).toHaveLength(1);
    expect(r.models[0]!.id).toBe('real-model');
  });
});

describe('probeMlx · remote node', () => {
  test('success · uses runRemote · host + user forwarded', async () => {
    const json = JSON.stringify({
      data: [{ id: 'mlx-community/Qwen2.5-72B-Instruct-4bit' }],
    });
    let seenHost: string | undefined;
    let seenUser: string | undefined;
    const r = await probeMlx(
      { id: 'node-b', isLocal: false, sshHost: 'node-b', sshUser: 'joo' },
      {
        runRemote: async (host, _argv, opts) => {
          seenHost = host;
          seenUser = opts.user;
          return { stdout: json, stderr: '' };
        },
        now: () => 1000,
      },
    );
    expect(seenHost).toBe('node-b');
    expect(seenUser).toBe('joo');
    expect(r.reachable).toBe(true);
    expect(r.models[0]!.nodeId).toBe('node-b');
    expect(r.baseUrl).toBe('http://node-b:8080/v1');
  });

  test('missing sshHost surfaces dedicated warning', async () => {
    const r = await probeMlx(
      { id: 'foreignHost', isLocal: false },
      { now: () => 1 },
    );
    expect(r.reachable).toBe(false);
    expect(r.warnings).toEqual(['missing-ssh-host']);
  });

  test('ssh-auth (Permission denied publickey) classified', async () => {
    const r = await probeMlx(
      { id: 'node-b', isLocal: false, sshHost: 'node-b' },
      {
        runRemote: async () => { throw new Error('Permission denied (publickey).'); },
        now: () => 1,
      },
    );
    expect(r.warnings).toEqual(['ssh-auth']);
  });

  test('unreachable (no route to host) classified', async () => {
    const r = await probeMlx(
      { id: 'node-b', isLocal: false, sshHost: 'node-b' },
      {
        runRemote: async () => { throw new Error('ssh: no route to host'); },
        now: () => 1,
      },
    );
    expect(r.warnings).toEqual(['unreachable']);
  });
});

describe('classifyMlxProbeError', () => {
  test('daemon-down for connection refused · curl exit 7', () => {
    expect(classifyMlxProbeError('connection refused on port 8080')).toBe('daemon-down');
    expect(classifyMlxProbeError('curl exited 7 · stderr=Failed to connect')).toBe('daemon-down');
  });

  test('ssh-timeout for timeout · curl exit 28', () => {
    expect(classifyMlxProbeError('probe timeout after 15000ms')).toBe('ssh-timeout');
    expect(classifyMlxProbeError('curl exited 28 · stderr=timed out')).toBe('ssh-timeout');
  });

  test('unreachable for no route · curl exit 6 (DNS)', () => {
    expect(classifyMlxProbeError('ssh: no route to host')).toBe('unreachable');
    expect(classifyMlxProbeError('curl exited 6 · stderr=Could not resolve')).toBe('unreachable');
  });

  test('cli-missing for command not found', () => {
    expect(classifyMlxProbeError('spawn curl ENOENT: command not found')).toBe('cli-missing');
  });

  test('ssh-auth for permission denied', () => {
    expect(classifyMlxProbeError('Permission denied (publickey).')).toBe('ssh-auth');
  });

  test('probe-error for uncategorized', () => {
    expect(classifyMlxProbeError('some unexpected error')).toBe('probe-error');
  });
});
