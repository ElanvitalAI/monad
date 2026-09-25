// FU3 (2026-05-13) — `McpClient` must drain `child.stderr` so a chatty
// external server (banner / warning / progress lines) cannot fill the
// 64KiB OS pipe buffer and stall its main loop. Pre-FU3, this happened
// silently: monad daemon awaited `client.start()` forever because the
// child stopped servicing stdin once its stderr.write() blocked. PR
// #2527's timeout bounded the wait; this test guarantees the listener
// stays attached so PR #2527 stops being the only safety net.

import { describe, expect, test } from 'bun:test';

import { McpClient, type ChildProcessLike } from '../src/mcp/client.js';

type StreamCb = (chunk: Buffer | string) => void;

interface FakeStream {
  on(event: 'data', cb: StreamCb): void;
  emit(chunk: Buffer | string): void;
}

function makeStream(): FakeStream {
  let cb: StreamCb | null = null;
  return {
    on: (_event, fn) => { cb = fn; },
    emit: (chunk) => { cb?.(chunk); },
  };
}

interface FakeChild extends ChildProcessLike {
  emitStdout(chunk: string): void;
  emitStderr(chunk: string): void;
  fireExit(code: number, signal?: string): void;
  writes: string[];
}

function makeFakeChild(): FakeChild {
  const stdout = makeStream();
  const stderr = makeStream();
  const writes: string[] = [];
  let exitCb: ((code: number | null, signal: string | null) => void) | null = null;
  return {
    stdin: { write: (line) => { writes.push(line); } },
    stdout,
    stderr,
    kill: () => true,
    on: (_event, cb) => { exitCb = cb; },
    pid: 42,
    emitStdout: (chunk) => stdout.emit(chunk),
    emitStderr: (chunk) => stderr.emit(chunk),
    fireExit: (code, signal) => exitCb?.(code, signal ?? null),
    writes,
  };
}

describe('McpClient — child.stderr drain (FU3)', () => {
  test('stderr lines emit `mcp.client.stderr` events with id + truncated line', async () => {
    const child = makeFakeChild();
    const logged: Array<{ event: string; data?: Record<string, unknown> }> = [];
    const client = new McpClient({
      id: 'xcode-trace',
      command: ['fake'],
      spawn: () => child,
      logger: (event, data) => { logged.push({ event, ...(data ? { data } : {}) }); },
    });
    const startP = client.start();
    // Child babbles on stderr before responding on stdout. Pre-FU3
    // this would have eventually deadlocked once the buffer filled;
    // now every line lands as a trace event.
    child.emitStderr('preparing xcode mcpbridge…\n');
    child.emitStderr('  loading 20 tools…\n');
    // Finally answers the handshake on stdout.
    child.emitStdout(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }) + '\n');
    await startP;
    const stderrEvents = logged.filter((e) => e.event === 'mcp.client.stderr');
    expect(stderrEvents).toHaveLength(2);
    expect(stderrEvents[0]!.data).toEqual({ id: 'xcode-trace', line: 'preparing xcode mcpbridge…' });
    expect(stderrEvents[1]!.data).toEqual({ id: 'xcode-trace', line: 'loading 20 tools…' });
  });

  test('multi-line stderr chunk splits cleanly + skips empty lines', async () => {
    const child = makeFakeChild();
    const logged: Array<{ event: string; data?: Record<string, unknown> }> = [];
    const client = new McpClient({
      id: 'multi',
      command: ['fake'],
      spawn: () => child,
      logger: (event, data) => { logged.push({ event, ...(data ? { data } : {}) }); },
    });
    const startP = client.start();
    child.emitStderr('line-a\n\n  line-b  \n');
    child.emitStdout(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }) + '\n');
    await startP;
    const stderrEvents = logged.filter((e) => e.event === 'mcp.client.stderr');
    expect(stderrEvents.map((e) => (e.data as { line: string }).line)).toEqual(['line-a', 'line-b']);
  });

  test('long stderr line truncates at 400 chars (trace tail stays scannable)', async () => {
    const child = makeFakeChild();
    const logged: Array<{ event: string; data?: Record<string, unknown> }> = [];
    const client = new McpClient({
      id: 'long-line',
      command: ['fake'],
      spawn: () => child,
      logger: (event, data) => { logged.push({ event, ...(data ? { data } : {}) }); },
    });
    const startP = client.start();
    const big = 'x'.repeat(500);
    child.emitStderr(big + '\n');
    child.emitStdout(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }) + '\n');
    await startP;
    const stderrEvent = logged.find((e) => e.event === 'mcp.client.stderr');
    expect(stderrEvent).toBeDefined();
    expect((stderrEvent!.data as { line: string }).line.length).toBe(400);
  });

  test('child without stderr field (test seam) — no throw, no listener attached', async () => {
    const stdout = makeStream();
    const childNoStderr: ChildProcessLike = {
      stdin: { write: () => {} },
      stdout,
      kill: () => true,
      on: () => {},
    };
    const client = new McpClient({
      id: 'no-stderr',
      command: ['fake'],
      spawn: () => childNoStderr,
      logger: () => {},
    });
    const startP = client.start();
    // Send a response so start() resolves.
    setTimeout(() => stdout.emit(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }) + '\n'), 0);
    expect(await startP).toBeUndefined();
  });
});
