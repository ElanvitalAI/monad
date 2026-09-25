import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveAgentTurnToolsKind, resolveToolsKind, runNexus } from '../src/nexus/index.js';
import { classifyNexusStatus } from '../src/nexus/status-line.js';

const originalFetch = globalThis.fetch;
const originalNexusDir = process.env.MONAD_NEXUS_DIR;
let root = '';
let output: string[] = [];
let logSpy: ReturnType<typeof spyOn>;

function writeRuntime(httpHost = '127.0.0.1', httpPort = 31415): void {
  writeFileSync(join(root, 'runtime.json'), JSON.stringify({
    pid: process.pid,
    startedAt: '2026-08-13T00:00:00.000Z',
    nexusVersion: '0.17.0',
    phase: 'test',
    httpHost,
    httpPort,
  }));
}

function writeLiveLock(): void {
  writeFileSync(join(root, '.lock'), JSON.stringify({
    pid: process.pid,
    host: hostname(),
    startedAt: '2026-08-13T00:00:00.000Z',
  }));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'monad-nexus-status-'));
  process.env.MONAD_NEXUS_DIR = root;
  output = [];
  logSpy = spyOn(console, 'log').mockImplementation((line: string) => { output.push(line); });
});

afterEach(() => {
  logSpy.mockRestore();
  globalThis.fetch = originalFetch;
  if (originalNexusDir === undefined) delete process.env.MONAD_NEXUS_DIR;
  else process.env.MONAD_NEXUS_DIR = originalNexusDir;
  rmSync(root, { recursive: true, force: true });
});

describe('tool-kind resolver status-line regression', () => {
  it('preserves chat and falls back from unrecognized values through both resolver paths', () => {
    for (const kind of ['readonly', 'webterm', 'chat', 'none'] as const) {
      expect(resolveToolsKind({ tools: kind })).toBe(kind);
      expect(resolveAgentTurnToolsKind({ tools: kind })).toBe(kind);
    }

    expect(resolveToolsKind({ tools: 'all' })).toBe('webterm');
    expect(resolveAgentTurnToolsKind({ tools: 'all' })).toBe('webterm');
  });
});

describe('classifyNexusStatus', () => {
  it('gives each lock and responsive-health combination a distinct status text', () => {
    const statuses = new Set([
      classifyNexusStatus({ lockAlive: true, health: 'responsive' }),
      classifyNexusStatus({ lockAlive: true, health: 'silent' }),
      classifyNexusStatus({ lockAlive: false, health: 'responsive' }),
      classifyNexusStatus({ lockAlive: false, health: 'silent' }),
    ]);

    expect(statuses).toEqual(new Set([
      'alive',
      'lock alive, http silent',
      'http responding without live lock',
      'not running',
    ]));
  });

  it('keeps a failed health observation distinct from a silent listener for either lock state', () => {
    expect(classifyNexusStatus({ lockAlive: true, health: 'unknown' })).toBe('http health unknown');
    expect(classifyNexusStatus({ lockAlive: false, health: 'unknown' })).toBe('http health unknown');
    expect(classifyNexusStatus({ lockAlive: true, health: 'silent' })).toBe('lock alive, http silent');
    expect(classifyNexusStatus({ lockAlive: false, health: 'silent' })).toBe('not running');
  });

  it('preserves alive for the healthy lock and listener path', () => {
    expect(classifyNexusStatus({ lockAlive: true, health: 'responsive' })).toBe('alive');
  });
});

describe('runNexus status health wiring', () => {
  it('maps a connection refusal through probe and classifier to http health unknown', async () => {
    writeLiveLock();
    writeRuntime();
    globalThis.fetch = mock(() => Promise.reject(new TypeError('connection refused'))) as unknown as typeof fetch;

    await runNexus({ status: true });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:31415/v1/health',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(output).toContain('  status    http health unknown (pid=' + process.pid + ' host=' + hostname() + ' since=2026-08-13T00:00:00.000Z)');
    expect(output).toContain('  root      ' + root);
    expect(output).toContain('  lock      ' + join(root, '.lock'));
    expect(output).toContain('  runtime   ' + join(root, 'runtime.json'));
    expect(output).toContain('  version   0.17.0 (phase: test)');
    expect(output).toContain('  http      http://127.0.0.1:31415');
  });

  it('reports a failed health probe without a live lock as unknown rather than not running', async () => {
    writeRuntime();
    globalThis.fetch = mock(() => Promise.reject(new TypeError('connection refused'))) as unknown as typeof fetch;

    await runNexus({ status: true });

    expect(output).toContain('  status    http health unknown');
    expect(output).not.toContain('  status    not running');
    expect(output).toContain('  root      ' + root);
    expect(output).toContain('  lock      ' + join(root, '.lock'));
    expect(output).toContain('  runtime   ' + join(root, 'runtime.json'));
    expect(output).toContain('  version   0.17.0 (phase: test)');
    expect(output).toContain('  http      http://127.0.0.1:31415');
  });

  it('reports a responsive listener without a live lock as a separate state', async () => {
    writeRuntime();
    globalThis.fetch = mock(() => Promise.resolve(new Response(null, { status: 204 }))) as unknown as typeof fetch;

    await runNexus({ status: true });

    expect(output).toContain('  status    http responding without live lock');
    expect(output).toContain('  http      http://127.0.0.1:31415');
  });

  it('reports a live lock with a non-success health response as http silent', async () => {
    writeLiveLock();
    writeRuntime();
    globalThis.fetch = mock(() => Promise.resolve(new Response(null, { status: 503 }))) as unknown as typeof fetch;

    await runNexus({ status: true });

    expect(output).toContain('  status    lock alive, http silent (pid=' + process.pid + ' host=' + hostname() + ' since=2026-08-13T00:00:00.000Z)');
  });

  it('probes an IPv6 runtime listener and reports the healthy lock path as alive', async () => {
    let requestedUrl = '';
    const server = Bun.serve({
      hostname: '::1',
      port: 0,
      fetch: (request) => {
        requestedUrl = request.url;
        return new Response(null, { status: new URL(request.url).pathname === '/v1/health' ? 204 : 404 });
      },
    });
    try {
      writeLiveLock();
      writeRuntime('::1', server.port);

      await runNexus({ status: true });

      expect(requestedUrl).toBe(`http://[::1]:${server.port}/v1/health`);
      expect(output).toContain('  status    alive (pid=' + process.pid + ' host=' + hostname() + ' since=2026-08-13T00:00:00.000Z)');
      expect(output).not.toContain('  status    http health unknown');
    } finally {
      server.stop(true);
    }
  });

  it('preserves not running and completes status output when no lock or runtime address exists', async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error('must not probe without runtime'))) as unknown as typeof fetch;

    await runNexus({ status: true });

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(output).toContain('  status    not running');
    expect(output).toContain('  root      ' + root);
    expect(output).toContain('  lock      ' + join(root, '.lock'));
    expect(output).toContain('  runtime   ' + join(root, 'runtime.json'));
  });

  it('treats a runtime without a probe address as silent while preserving lock metadata', async () => {
    writeLiveLock();
    writeFileSync(join(root, 'runtime.json'), JSON.stringify({
      pid: process.pid,
      startedAt: '2026-08-13T00:00:00.000Z',
      nexusVersion: '0.17.0',
      phase: 'test',
    }));
    globalThis.fetch = mock(() => Promise.reject(new Error('must not probe without address'))) as unknown as typeof fetch;

    await runNexus({ status: true });

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(output).toContain('  status    lock alive, http silent (pid=' + process.pid + ' host=' + hostname() + ' since=2026-08-13T00:00:00.000Z)');
    expect(output).toContain('  version   0.17.0 (phase: test)');
  });
});
