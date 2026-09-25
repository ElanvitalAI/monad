// H6 P2 Bundle 2 C1 · Ollama HTTP probe tests.
//
// Mirrors test/llm-lmstudio-probe.test.ts. Covers:
//   - curl arg composition (local + remote via runLocal/runRemote fakes)
//   - JSON parsing (models[].name/size/details.format)
//   - Error classification (daemon-down · cli-missing · parse-failed ·
//     unreachable · ssh-timeout · ssh-auth)
//   - Side effects on node-registry (reachable · ollamaBaseUrl ·
//     runtimes=['ollama'] on success)

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  probeOllama,
  classifyOllamaProbeError,
} from '../src/llm/local-manager/ollama-probe.js';
import {
  _getNodeStatusForTesting,
  _resetNodeStatusForTesting,
} from '../src/llm/local-manager/node-registry.js';

beforeEach(() => {
  _resetNodeStatusForTesting();
});

describe('probeOllama · local node', () => {
  test('success · parses models[] · populates status cache', async () => {
    const json = JSON.stringify({
      models: [
        {
          name: 'llama3.1:8b',
          size: 4661211648,
          details: { format: 'gguf', parameter_size: '8.0B' },
        },
        {
          name: 'qwen2.5-coder:7b',
          size: 4700000000,
          details: { format: 'gguf' },
        },
      ],
    });
    const r = await probeOllama(
      { id: 'local', isLocal: true },
      {
        runLocal: async () => ({ stdout: json, stderr: '' }),
        now: () => 1000,
      },
    );
    expect(r.reachable).toBe(true);
    expect(r.runtime).toBe('ollama');
    expect(r.models).toHaveLength(2);
    expect(r.models[0]!.id).toBe('llama3.1:8b');
    expect(r.models[0]!.sizeBytes).toBe(4661211648);
    expect(r.models[0]!.format).toBe('gguf');
    expect(r.models[0]!.runtime).toBe('ollama');
    expect(r.baseUrl).toBe('http://localhost:11434/v1');
    expect(r.warnings).toEqual([]);
    const status = _getNodeStatusForTesting('local');
    expect(status?.reachable).toBe(true);
    expect(status?.runtimes).toEqual(['ollama']);
    expect(status?.ollamaBaseUrl).toBe('http://localhost:11434/v1');
  });

  test('empty models → reachable + no-models warning', async () => {
    const r = await probeOllama(
      { id: 'local', isLocal: true },
      {
        runLocal: async () => ({ stdout: JSON.stringify({ models: [] }), stderr: '' }),
        now: () => 1000,
      },
    );
    expect(r.reachable).toBe(true);
    expect(r.warnings).toEqual(['no-models']);
    expect(r.models).toEqual([]);
  });

  test('daemon down (curl exit 7 · connection refused) classified', async () => {
    const r = await probeOllama(
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
    const r = await probeOllama(
      { id: 'local', isLocal: true },
      {
        runLocal: async () => { throw new Error('spawn curl ENOENT: command not found'); },
        now: () => 1000,
      },
    );
    expect(r.warnings).toEqual(['cli-missing']);
  });

  test('malformed JSON → reachable but parse-failed warning', async () => {
    const r = await probeOllama(
      { id: 'local', isLocal: true },
      {
        runLocal: async () => ({ stdout: '<html>not JSON</html>', stderr: '' }),
        now: () => 1000,
      },
    );
    expect(r.reachable).toBe(true);
    expect(r.warnings).toContain('parse-failed');
    expect(r.models).toEqual([]);
  });

  test('uses spawn-timeout message as ssh-timeout', async () => {
    const r = await probeOllama(
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
    await probeOllama(
      { id: 'local', isLocal: true },
      {
        runLocal: async (argv) => {
          seenArgv = argv;
          return { stdout: JSON.stringify({ models: [] }), stderr: '' };
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
    expect(seenArgv).toContain('http://127.0.0.1:11434/api/tags');
  });
});

describe('probeOllama · remote node', () => {
  test('success · uses runRemote · host + user forwarded', async () => {
    const json = JSON.stringify({
      models: [{ name: 'llama3.1:70b', size: 40e9, details: { format: 'gguf' } }],
    });
    let seenHost: string | undefined;
    let seenUser: string | undefined;
    const r = await probeOllama(
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
    expect(r.baseUrl).toBe('http://node-b:11434/v1');
  });

  test('missing sshHost surfaces dedicated warning', async () => {
    const r = await probeOllama(
      { id: 'foreignHost', isLocal: false },
      { now: () => 1 },
    );
    expect(r.reachable).toBe(false);
    expect(r.warnings).toEqual(['missing-ssh-host']);
  });

  test('ssh-auth (Permission denied publickey) classified', async () => {
    const r = await probeOllama(
      { id: 'node-b', isLocal: false, sshHost: 'node-b' },
      {
        runRemote: async () => { throw new Error('Permission denied (publickey).'); },
        now: () => 1,
      },
    );
    expect(r.warnings).toEqual(['ssh-auth']);
  });

  test('unreachable (no route to host) classified', async () => {
    const r = await probeOllama(
      { id: 'node-b', isLocal: false, sshHost: 'node-b' },
      {
        runRemote: async () => { throw new Error('ssh: no route to host'); },
        now: () => 1,
      },
    );
    expect(r.warnings).toEqual(['unreachable']);
  });
});

describe('classifyOllamaProbeError (shared + Ollama-specific)', () => {
  test('daemon-down for connection refused · curl exit 7', () => {
    expect(classifyOllamaProbeError('connection refused on port 11434')).toBe('daemon-down');
    expect(classifyOllamaProbeError('curl exited 7 · stderr=Failed to connect')).toBe('daemon-down');
  });

  test('ssh-timeout for timeout · curl exit 28', () => {
    expect(classifyOllamaProbeError('probe timeout after 15000ms')).toBe('ssh-timeout');
    expect(classifyOllamaProbeError('curl exited 28 · stderr=timed out')).toBe('ssh-timeout');
  });

  test('unreachable for no route · curl exit 6 (DNS)', () => {
    expect(classifyOllamaProbeError('ssh: no route to host')).toBe('unreachable');
    expect(classifyOllamaProbeError('curl exited 6 · stderr=Could not resolve')).toBe('unreachable');
  });

  test('cli-missing for command not found', () => {
    expect(classifyOllamaProbeError('spawn curl ENOENT: command not found')).toBe('cli-missing');
  });

  test('ssh-auth for permission denied', () => {
    expect(classifyOllamaProbeError('Permission denied (publickey).')).toBe('ssh-auth');
  });

  test('probe-error for uncategorized', () => {
    expect(classifyOllamaProbeError('some unexpected error')).toBe('probe-error');
  });
});
