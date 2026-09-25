// H6 P2 Bundle 2 C3 · Docker probe tests.
//
// Covers:
//   - `docker ps --format '{{json .}}'` argv composition (local + remote)
//   - JSON-per-line parsing (`parseDockerPsLines`)
//   - Image-name filter (ollama/vllm/tgi/text-generation-inference/llama)
//   - Port extraction from `Ports` field
//   - Error classification (daemon-down via "Cannot connect to the
//     Docker daemon" · cli-missing · unreachable · ssh-timeout · ssh-auth)
//   - Side effects on node-registry (reachable · dockerBaseUrl ·
//     runtimes=['docker'] on success · first matched container drives
//     baseUrl)

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  probeDocker,
  classifyDockerProbeError,
  parseDockerPsLines,
  extractHostPort,
} from '../src/llm/local-manager/docker-probe.js';
import {
  _getNodeStatusForTesting,
  _resetNodeStatusForTesting,
} from '../src/llm/local-manager/node-registry.js';

beforeEach(() => {
  _resetNodeStatusForTesting();
});

/** Helper: a single container JSON line as docker emits it. */
function psLine(c: {
  id?: string;
  name: string;
  image: string;
  ports?: string;
}): string {
  return JSON.stringify({
    ID: c.id ?? 'abc123',
    Names: c.name,
    Image: c.image,
    Ports: c.ports ?? '',
    State: 'running',
    Status: 'Up 2 hours',
  });
}

describe('probeDocker · local node', () => {
  test('success · filters LLM images · extracts baseUrl · populates status', async () => {
    const stdout = [
      psLine({
        name: 'ollama-server',
        image: 'ollama/ollama:latest',
        ports: '0.0.0.0:11435->11434/tcp, :::11435->11434/tcp',
      }),
      psLine({
        name: 'postgres',
        image: 'postgres:16',
        ports: '0.0.0.0:5432->5432/tcp',
      }),
      psLine({
        name: 'vllm-qwen',
        image: 'vllm/vllm-openai:latest',
        ports: '0.0.0.0:8000->8000/tcp',
      }),
    ].join('\n');

    const r = await probeDocker(
      { id: 'local', isLocal: true },
      {
        runLocal: async () => ({ stdout, stderr: '' }),
        now: () => 1000,
      },
    );
    expect(r.reachable).toBe(true);
    expect(r.runtime).toBe('docker');
    // postgres excluded · ollama + vllm kept
    expect(r.models).toHaveLength(2);
    const ids = r.models.map((m) => m.id).sort();
    expect(ids).toContain('ollama:latest@ollama-server');
    expect(ids).toContain('vllm-openai:latest@vllm-qwen');
    expect(r.models[0]!.runtime).toBe('docker');
    expect(r.models[0]!.format).toBe('docker');
    // First matched container drives baseUrl · ollama with host port 11435.
    expect(r.baseUrl).toBe('http://localhost:11435/v1');
    const status = _getNodeStatusForTesting('local');
    expect(status?.reachable).toBe(true);
    expect(status?.runtimes).toEqual(['docker']);
    expect(status?.dockerBaseUrl).toBe('http://localhost:11435/v1');
  });

  test('empty stdout (daemon up · no containers) → reachable + no-models', async () => {
    const r = await probeDocker(
      { id: 'local', isLocal: true },
      {
        runLocal: async () => ({ stdout: '', stderr: '' }),
        now: () => 1,
      },
    );
    expect(r.reachable).toBe(true);
    expect(r.warnings).toContain('no-models');
    expect(r.models).toEqual([]);
  });

  test('non-LLM containers only → reachable + no-models · no baseUrl', async () => {
    const stdout = [
      psLine({ name: 'postgres', image: 'postgres:16', ports: '0.0.0.0:5432->5432/tcp' }),
      psLine({ name: 'redis', image: 'redis:7', ports: '0.0.0.0:6379->6379/tcp' }),
    ].join('\n');
    const r = await probeDocker(
      { id: 'local', isLocal: true },
      {
        runLocal: async () => ({ stdout, stderr: '' }),
        now: () => 1,
      },
    );
    expect(r.reachable).toBe(true);
    expect(r.warnings).toContain('no-models');
    expect(r.baseUrl).toBeUndefined();
    const status = _getNodeStatusForTesting('local');
    expect(status?.dockerBaseUrl).toBeUndefined();
  });

  test('daemon down (Cannot connect) classified', async () => {
    const r = await probeDocker(
      { id: 'local', isLocal: true },
      {
        runLocal: async () => {
          throw new Error('Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?');
        },
        now: () => 1,
      },
    );
    expect(r.reachable).toBe(false);
    expect(r.warnings).toEqual(['daemon-down']);
    expect(r.models).toEqual([]);
  });

  test('docker CLI missing (ENOENT) classified', async () => {
    const r = await probeDocker(
      { id: 'local', isLocal: true },
      {
        runLocal: async () => { throw new Error('spawn docker ENOENT: command not found'); },
        now: () => 1,
      },
    );
    expect(r.warnings).toEqual(['cli-missing']);
  });

  test('passes docker argv through runLocal', async () => {
    let seenArgv: readonly string[] | undefined;
    await probeDocker(
      { id: 'local', isLocal: true },
      {
        runLocal: async (argv) => {
          seenArgv = argv;
          return { stdout: '', stderr: '' };
        },
        now: () => 1,
      },
    );
    expect(seenArgv).toEqual(['docker', 'ps', '--format', '{{json .}}']);
  });

  test('matches llama image substring (case-insensitive)', async () => {
    const stdout = psLine({
      name: 'llama-server',
      image: 'ghcr.io/ggerganov/llama.cpp:server',
      ports: '0.0.0.0:8080->8080/tcp',
    });
    const r = await probeDocker(
      { id: 'local', isLocal: true },
      {
        runLocal: async () => ({ stdout, stderr: '' }),
        now: () => 1,
      },
    );
    expect(r.reachable).toBe(true);
    expect(r.models).toHaveLength(1);
    expect(r.baseUrl).toBe('http://localhost:8080/v1');
  });

  test('text-generation-inference image matched', async () => {
    const stdout = psLine({
      name: 'tgi-flan',
      image: 'ghcr.io/huggingface/text-generation-inference:latest',
      ports: '0.0.0.0:3000->80/tcp',
    });
    const r = await probeDocker(
      { id: 'local', isLocal: true },
      {
        runLocal: async () => ({ stdout, stderr: '' }),
        now: () => 1,
      },
    );
    expect(r.reachable).toBe(true);
    expect(r.models).toHaveLength(1);
    expect(r.baseUrl).toBe('http://localhost:3000/v1');
  });

  test('LLM container with no published port still counts · baseUrl null', async () => {
    const stdout = psLine({
      name: 'ollama-internal',
      image: 'ollama/ollama:latest',
      // Only internal port (no `<host>:<port>->`)
      ports: '11434/tcp',
    });
    const r = await probeDocker(
      { id: 'local', isLocal: true },
      {
        runLocal: async () => ({ stdout, stderr: '' }),
        now: () => 1,
      },
    );
    expect(r.reachable).toBe(true);
    expect(r.models).toHaveLength(1);
    expect(r.baseUrl).toBeUndefined();
  });

  test('malformed JSON line → parse-failed warning but keeps parseable lines', async () => {
    const stdout = [
      '{ not valid json',
      psLine({ name: 'ollama', image: 'ollama/ollama:latest', ports: '0.0.0.0:11434->11434/tcp' }),
    ].join('\n');
    const r = await probeDocker(
      { id: 'local', isLocal: true },
      {
        runLocal: async () => ({ stdout, stderr: '' }),
        now: () => 1,
      },
    );
    expect(r.reachable).toBe(true);
    expect(r.warnings).toContain('parse-failed');
    expect(r.models).toHaveLength(1);
  });
});

describe('probeDocker · remote node', () => {
  test('success · uses runRemote · host-based baseUrl', async () => {
    const stdout = psLine({
      name: 'node-b-ollama',
      image: 'ollama/ollama:latest',
      ports: '0.0.0.0:11434->11434/tcp',
    });
    let seenHost: string | undefined;
    const r = await probeDocker(
      { id: 'node-b', isLocal: false, sshHost: 'node-b' },
      {
        runRemote: async (host) => {
          seenHost = host;
          return { stdout, stderr: '' };
        },
        now: () => 1,
      },
    );
    expect(seenHost).toBe('node-b');
    expect(r.reachable).toBe(true);
    expect(r.models[0]!.nodeId).toBe('node-b');
    expect(r.baseUrl).toBe('http://node-b:11434/v1');
  });

  test('missing sshHost → missing-ssh-host warning', async () => {
    const r = await probeDocker(
      { id: 'foreignHost', isLocal: false },
      { now: () => 1 },
    );
    expect(r.reachable).toBe(false);
    expect(r.warnings).toEqual(['missing-ssh-host']);
  });

  test('ssh-auth (Permission denied) classified', async () => {
    const r = await probeDocker(
      { id: 'node-b', isLocal: false, sshHost: 'node-b' },
      {
        runRemote: async () => { throw new Error('Permission denied (publickey).'); },
        now: () => 1,
      },
    );
    expect(r.warnings).toEqual(['ssh-auth']);
  });
});

describe('classifyDockerProbeError', () => {
  test('daemon-down for "Cannot connect to the Docker daemon"', () => {
    expect(classifyDockerProbeError(
      'Cannot connect to the Docker daemon at unix:///var/run/docker.sock',
    )).toBe('daemon-down');
    expect(classifyDockerProbeError(
      'Is the docker daemon running?',
    )).toBe('daemon-down');
  });

  test('cli-missing for ENOENT / command not found', () => {
    expect(classifyDockerProbeError('spawn docker ENOENT')).toBe('cli-missing');
    expect(classifyDockerProbeError('docker: command not found')).toBe('cli-missing');
  });

  test('ssh-timeout for probe timeout', () => {
    expect(classifyDockerProbeError('probe timeout after 15000ms')).toBe('ssh-timeout');
  });

  test('unreachable for no route / unreachable', () => {
    expect(classifyDockerProbeError('ssh: no route to host')).toBe('unreachable');
  });

  test('ssh-auth for permission denied', () => {
    expect(classifyDockerProbeError('Permission denied (publickey).')).toBe('ssh-auth');
  });

  test('probe-error for uncategorized', () => {
    expect(classifyDockerProbeError('some unexpected docker error')).toBe('probe-error');
  });
});

describe('parseDockerPsLines', () => {
  test('splits newline-delimited JSON · tolerates blank lines', () => {
    const stdout = [
      '',
      '{"Names":"a","Image":"foo"}',
      '   ',
      '{"Names":"b","Image":"bar"}',
      '',
    ].join('\n');
    const { containers, parseFailed } = parseDockerPsLines(stdout);
    expect(parseFailed).toBe(false);
    expect(containers).toHaveLength(2);
    expect(containers[0]!.Names).toBe('a');
    expect(containers[1]!.Names).toBe('b');
  });

  test('marks parseFailed but keeps valid lines when one is malformed', () => {
    const stdout = [
      '{"Names":"good","Image":"x"}',
      '{ bad json',
      '{"Names":"good2","Image":"y"}',
    ].join('\n');
    const { containers, parseFailed } = parseDockerPsLines(stdout);
    expect(parseFailed).toBe(true);
    expect(containers).toHaveLength(2);
  });
});

describe('remote SSH wrapping (fleet fixups 2026-04-22)', () => {
  // Regression: the initial C3 impl passed argv individually to ssh so
  // `ssh host docker ps --format '{{json .}}'` reached remote zsh as
  // unquoted braces → `parse error near '}'`. Probe now shell-quotes
  // each argv element so braces survive transit literally.
  test('runRemote receives the Docker argv · fake must handle single-quoted shape on real SSH', async () => {
    let seenArgv: readonly string[] | undefined;
    await probeDocker(
      { id: 'node-b', isLocal: false, sshHost: 'node-b' },
      {
        runRemote: async (_host, argv) => {
          seenArgv = argv;
          return { stdout: '', stderr: '' };
        },
        now: () => 1,
      },
    );
    // deps.runRemote is called with the un-quoted argv (the default
    // runner handles quoting). Tests exercising the quoting behavior
    // live at integration level; here we just confirm the brace-bearing
    // argument travels through intact so the default runner sees it.
    expect(seenArgv).toEqual(['docker', 'ps', '--format', '{{json .}}']);
  });
});

describe('extractHostPort', () => {
  test('returns first IPv4 published host port', () => {
    expect(extractHostPort('0.0.0.0:11434->11434/tcp')).toBe(11434);
    expect(extractHostPort('0.0.0.0:8000->8000/tcp, :::8000->8000/tcp')).toBe(8000);
    expect(extractHostPort('127.0.0.1:3000->80/tcp')).toBe(3000);
  });

  test('returns null for internal-only port', () => {
    expect(extractHostPort('11434/tcp')).toBeNull();
  });

  test('returns null for empty / undefined', () => {
    expect(extractHostPort('')).toBeNull();
    expect(extractHostPort(undefined)).toBeNull();
  });

  test('handles multiple mappings · picks first numeric', () => {
    expect(extractHostPort('0.0.0.0:8080->8080/tcp, 0.0.0.0:9090->9090/tcp')).toBe(8080);
  });
});
