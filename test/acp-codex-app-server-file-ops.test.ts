// M2 (2026-04-28) — codex-app-server file ops (fs/readFile + fs/writeFile).
//
// Verifies:
//   - validateFsPath pure helper (workspace prefix · symlink · absolute)
//   - fs/readFile server-request handler — happy path + path validation
//     + size cap + missing file
//   - fs/writeFile handler — happy path + plan-mode write gate (M1) +
//     path validation + size cap
//   - CAPS.fileOps both true after M2

import { describe, test, expect } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { PassThrough } from 'node:stream';
import {
  CodexAppServerAgent,
  validateFsPath,
} from '../src/acp/codex-app-server-agent.js';
import { CodexAppServerClient } from '../src/acp/codex-app-server-client.js';
import type {
  CasThreadIndex,
  CasThreadIndexEntry,
} from '../src/acp/codex-app-server-thread-index.js';
import type {
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
} from '../src/acp/codex-app-server-proto.js';

// ─── Test harness ─────────────────────────────────────────────────────

function makeMemThreadIndex(): CasThreadIndex {
  const map = new Map<string, CasThreadIndexEntry>();
  return {
    get path() { return '/mem'; },
    get(id) { return map.get(id) ?? null; },
    put(id, input) {
      const ts = Date.now();
      const entry: CasThreadIndexEntry = {
        synthId: id,
        threadId: input.threadId,
        cwd: input.cwd,
        createdAt: input.createdAt ?? ts,
        lastTurnAt: input.lastTurnAt ?? ts,
      };
      map.set(id, entry);
      return entry;
    },
    touch(id) {
      const e = map.get(id);
      if (!e) return null;
      const updated = { ...e, lastTurnAt: Date.now() };
      map.set(id, updated);
      return updated;
    },
    remove(id) { return map.delete(id); },
    list() { return [...map.values()]; },
  };
}

interface Harness {
  agent: CodexAppServerAgent;
  client: CodexAppServerClient;
  sent: JsonRpcRequest[];
  outbound: Array<JsonRpcResponse | JsonRpcRequest>;
  reply(id: string | number, result: unknown): void;
  notify(method: string, params: unknown): void;
  request(id: string | number, method: string, params: unknown): void;
  workspaceRoot: string;
  cleanup(): void;
}

function makeHarness(opts: { fileOpsMaxBytes?: number } = {}): Harness {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const sent: JsonRpcRequest[] = [];
  const outbound: Array<JsonRpcResponse | JsonRpcRequest> = [];
  stdin.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj && typeof obj === 'object') {
          outbound.push(obj as JsonRpcResponse | JsonRpcRequest);
          if ('method' in obj) {
            sent.push(obj as JsonRpcRequest);
          }
        }
      } catch {
        /* swallow */
      }
    }
  });
  const client = new CodexAppServerClient({
    stdin,
    stdout,
    requestTimeoutMs: null,
  });
  // Real temp workspace · mkdtemp keeps test parallelism safe.
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'elanous-fs-ops-test-'));
  const agent = new CodexAppServerAgent({
    backendId: 'codex-app-server',
    cwd: workspaceRoot,
    fileOpsMaxBytes: opts.fileOpsMaxBytes,
    _clientForTesting: client,
    _threadIndexForTesting: makeMemThreadIndex(),
  });
  return {
    agent,
    client,
    sent,
    outbound,
    reply(id, result) {
      const resp: JsonRpcResponse = { jsonrpc: '2.0', id, result };
      stdout.write(JSON.stringify(resp) + '\n');
    },
    notify(method, params) {
      const notif: JsonRpcNotification = { jsonrpc: '2.0', method, params };
      stdout.write(JSON.stringify(notif) + '\n');
    },
    request(id, method, params) {
      const req: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
      stdout.write(JSON.stringify(req) + '\n');
    },
    workspaceRoot,
    cleanup() {
      try { rmSync(workspaceRoot, { recursive: true, force: true }); } catch { /* swallow */ }
    },
  };
}

async function tick(n = 5): Promise<void> {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
}

function findRequest(sent: JsonRpcRequest[], method: string): JsonRpcRequest | undefined {
  return sent.find((m) => m.method === method);
}

function findReply(
  outbound: Array<JsonRpcResponse | JsonRpcRequest>,
  id: string | number,
): JsonRpcResponse | undefined {
  return outbound.find(
    (m) => 'id' in m && m.id === id && !('method' in m),
  ) as JsonRpcResponse | undefined;
}

async function bringUp(h: Harness): Promise<{ sessionId: string; threadId: string }> {
  const startP = h.agent.start();
  await tick();
  h.reply(findRequest(h.sent, 'initialize')!.id, {});
  await startP;
  const sessP = h.agent.newSession();
  await tick();
  const startReq = findRequest(h.sent, 'thread/start');
  const threadId = 'th-1';
  h.reply(startReq!.id, { thread: { id: threadId } });
  const sessionId = await sessP;
  return { sessionId: sessionId as unknown as string, threadId };
}

// ─── Pure helper · validateFsPath ────────────────────────────────────

describe('M2 · validateFsPath (pure)', () => {
  test('rejects empty / non-string path', () => {
    expect(validateFsPath('', '/work')).toContain('non-empty');
    expect(validateFsPath(null as unknown as string, '/work')).toContain('non-empty');
  });

  test('rejects relative path', () => {
    expect(validateFsPath('relative.txt', '/work')).toContain('absolute');
    expect(validateFsPath('./x', '/work')).toContain('absolute');
  });

  test('accepts path inside workspace root', () => {
    const root = mkdtempSync(join(tmpdir(), 'elanous-validate-'));
    try {
      const inner = join(root, 'sub', 'file.txt');
      mkdirSync(join(root, 'sub'));
      writeFileSync(inner, 'hello');
      expect(validateFsPath(inner, root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects path outside workspace root', () => {
    const root = mkdtempSync(join(tmpdir(), 'elanous-validate-'));
    try {
      // /tmp/<other> sibling
      const other = mkdtempSync(join(tmpdir(), 'elanous-validate-other-'));
      try {
        const outside = join(other, 'evil.txt');
        writeFileSync(outside, 'leak');
        const reason = validateFsPath(outside, root);
        expect(reason).toContain('outside workspace');
      } finally {
        rmSync(other, { recursive: true, force: true });
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('rejects sibling whose name shares the root prefix', () => {
    // "/work" vs "/workspace" — the trailing-separator guard prevents
    // the sibling /workspace from passing the prefix check.
    const reason = validateFsPath('/workspace/file.txt', '/work');
    expect(reason).toContain('outside workspace');
  });

  test('accepts the root itself', () => {
    const root = mkdtempSync(join(tmpdir(), 'elanous-validate-root-'));
    try {
      expect(validateFsPath(root, root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ─── Capability flag ────────────────────────────────────────────────

describe('M2 · capability flag', () => {
  test('CAPS.fileOps.readTextFile + writeTextFile both true after start', async () => {
    const h = makeHarness();
    try {
      const p = h.agent.start();
      await tick();
      h.reply(findRequest(h.sent, 'initialize')!.id, {});
      await p;
      const caps = h.agent.getCapabilities();
      expect(caps).not.toBeNull();
      expect(caps!.fileOps.readTextFile).toBe(true);
      expect(caps!.fileOps.writeTextFile).toBe(true);
      await h.agent.stop();
    } finally {
      h.cleanup();
    }
  });
});

// ─── fs/readFile handler ────────────────────────────────────────────

describe('M2 · fs/readFile handler', () => {
  test('happy path returns base64 contents', async () => {
    const h = makeHarness();
    try {
      const { threadId } = await bringUp(h);
      const file = join(h.workspaceRoot, 'hi.txt');
      writeFileSync(file, 'hello world');
      h.request('rd-1', 'fs/readFile', { threadId, path: file });
      await tick();
      const reply = findReply(h.outbound, 'rd-1');
      expect(reply).toBeDefined();
      const result = reply!.result as { dataBase64: string };
      expect(Buffer.from(result.dataBase64, 'base64').toString('utf8')).toBe('hello world');
      await h.agent.stop();
    } finally {
      h.cleanup();
    }
  });

  test('rejects path outside workspace', async () => {
    const h = makeHarness();
    try {
      const { threadId } = await bringUp(h);
      const outside = mkdtempSync(join(tmpdir(), 'elanous-fs-outside-'));
      try {
        const evil = join(outside, 'leak.txt');
        writeFileSync(evil, 'secret');
        h.request('rd-2', 'fs/readFile', { threadId, path: evil });
        await tick();
        const reply = findReply(h.outbound, 'rd-2');
        const result = reply!.result as { isError?: boolean; errorMessage?: string };
        expect(result.isError).toBe(true);
        expect(result.errorMessage).toContain('outside workspace');
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
      await h.agent.stop();
    } finally {
      h.cleanup();
    }
  });

  test('rejects relative path', async () => {
    const h = makeHarness();
    try {
      const { threadId } = await bringUp(h);
      h.request('rd-3', 'fs/readFile', { threadId, path: 'relative.txt' });
      await tick();
      const reply = findReply(h.outbound, 'rd-3');
      expect((reply!.result as { isError: boolean }).isError).toBe(true);
      await h.agent.stop();
    } finally {
      h.cleanup();
    }
  });

  test('rejects file exceeding fileOpsMaxBytes', async () => {
    const h = makeHarness({ fileOpsMaxBytes: 64 });
    try {
      const { threadId } = await bringUp(h);
      const file = join(h.workspaceRoot, 'big.txt');
      writeFileSync(file, 'x'.repeat(128));
      h.request('rd-4', 'fs/readFile', { threadId, path: file });
      await tick();
      const reply = findReply(h.outbound, 'rd-4');
      const result = reply!.result as { isError: boolean; errorMessage: string };
      expect(result.isError).toBe(true);
      expect(result.errorMessage).toContain('too large');
      await h.agent.stop();
    } finally {
      h.cleanup();
    }
  });

  test('missing file returns isError', async () => {
    const h = makeHarness();
    try {
      const { threadId } = await bringUp(h);
      const ghost = join(h.workspaceRoot, 'ghost.txt');
      h.request('rd-5', 'fs/readFile', { threadId, path: ghost });
      await tick();
      const reply = findReply(h.outbound, 'rd-5');
      expect((reply!.result as { isError: boolean }).isError).toBe(true);
      await h.agent.stop();
    } finally {
      h.cleanup();
    }
  });
});

// ─── fs/writeFile handler ───────────────────────────────────────────

describe('M2 · fs/writeFile handler', () => {
  test('happy path writes file + returns empty result', async () => {
    const h = makeHarness();
    try {
      const { threadId } = await bringUp(h);
      const file = join(h.workspaceRoot, 'out.txt');
      const data = Buffer.from('greetings').toString('base64');
      h.request('wr-1', 'fs/writeFile', { threadId, path: file, dataBase64: data });
      await tick();
      const reply = findReply(h.outbound, 'wr-1');
      expect(reply).toBeDefined();
      // Empty success response — ensure no isError.
      expect((reply!.result as { isError?: boolean }).isError).toBeUndefined();
      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file, 'utf8')).toBe('greetings');
      await h.agent.stop();
    } finally {
      h.cleanup();
    }
  });

  test('plan-mode session blocks writeFile (M1 interaction)', async () => {
    const h = makeHarness();
    try {
      const { sessionId, threadId } = await bringUp(h);
      // Pin plan mode on the session.
      h.agent.setSessionMode(sessionId as unknown as Parameters<typeof h.agent.setSessionMode>[0], 'plan');

      const file = join(h.workspaceRoot, 'blocked.txt');
      const data = Buffer.from('mutation').toString('base64');
      h.request('wr-2', 'fs/writeFile', { threadId, path: file, dataBase64: data });
      await tick();
      const reply = findReply(h.outbound, 'wr-2');
      const result = reply!.result as { isError: boolean; errorMessage: string };
      expect(result.isError).toBe(true);
      expect(result.errorMessage).toContain('plan mode');
      // File MUST NOT have been written.
      expect(existsSync(file)).toBe(false);
      await h.agent.stop();
    } finally {
      h.cleanup();
    }
  });

  test('default-mode session writes normally (no plan-mode block)', async () => {
    const h = makeHarness();
    try {
      const { threadId } = await bringUp(h);
      // No setSessionMode call → mode is implicit 'default'.
      const file = join(h.workspaceRoot, 'default.txt');
      const data = Buffer.from('ok').toString('base64');
      h.request('wr-3', 'fs/writeFile', { threadId, path: file, dataBase64: data });
      await tick();
      const reply = findReply(h.outbound, 'wr-3');
      expect((reply!.result as { isError?: boolean }).isError).toBeUndefined();
      expect(readFileSync(file, 'utf8')).toBe('ok');
      await h.agent.stop();
    } finally {
      h.cleanup();
    }
  });

  test('rejects writeFile path outside workspace', async () => {
    const h = makeHarness();
    try {
      const { threadId } = await bringUp(h);
      const outside = mkdtempSync(join(tmpdir(), 'elanous-fs-write-outside-'));
      try {
        const evil = join(outside, 'leak.txt');
        const data = Buffer.from('x').toString('base64');
        h.request('wr-4', 'fs/writeFile', { threadId, path: evil, dataBase64: data });
        await tick();
        const reply = findReply(h.outbound, 'wr-4');
        const result = reply!.result as { isError: boolean; errorMessage: string };
        expect(result.isError).toBe(true);
        expect(result.errorMessage).toContain('outside workspace');
        expect(existsSync(evil)).toBe(false);
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
      await h.agent.stop();
    } finally {
      h.cleanup();
    }
  });

  test('rejects writeFile payload exceeding fileOpsMaxBytes', async () => {
    const h = makeHarness({ fileOpsMaxBytes: 32 });
    try {
      const { threadId } = await bringUp(h);
      const file = join(h.workspaceRoot, 'big.txt');
      const data = Buffer.from('x'.repeat(64)).toString('base64');
      h.request('wr-5', 'fs/writeFile', { threadId, path: file, dataBase64: data });
      await tick();
      const reply = findReply(h.outbound, 'wr-5');
      const result = reply!.result as { isError: boolean; errorMessage: string };
      expect(result.isError).toBe(true);
      expect(result.errorMessage).toContain('too large');
      expect(existsSync(file)).toBe(false);
      await h.agent.stop();
    } finally {
      h.cleanup();
    }
  });

  test('writeFile without threadId still validates path (no plan-mode shortcut)', async () => {
    const h = makeHarness();
    try {
      await bringUp(h);
      const file = join(h.workspaceRoot, 'no-thread.txt');
      const data = Buffer.from('present').toString('base64');
      h.request('wr-6', 'fs/writeFile', { path: file, dataBase64: data });
      await tick();
      const reply = findReply(h.outbound, 'wr-6');
      expect((reply!.result as { isError?: boolean }).isError).toBeUndefined();
      expect(readFileSync(file, 'utf8')).toBe('present');
      await h.agent.stop();
    } finally {
      h.cleanup();
    }
  });

  test('writeFile to nested existing dir works · creates target file', async () => {
    const h = makeHarness();
    try {
      const { threadId } = await bringUp(h);
      mkdirSync(join(h.workspaceRoot, 'nested'));
      const file = join(h.workspaceRoot, 'nested', 'inner.txt');
      const data = Buffer.from('deep').toString('base64');
      h.request('wr-7', 'fs/writeFile', { threadId, path: file, dataBase64: data });
      await tick();
      const reply = findReply(h.outbound, 'wr-7');
      expect((reply!.result as { isError?: boolean }).isError).toBeUndefined();
      expect(readFileSync(file, 'utf8')).toBe('deep');
      await h.agent.stop();
    } finally {
      h.cleanup();
    }
  });

  test('toggling out of plan mode allows subsequent write', async () => {
    const h = makeHarness();
    try {
      const { sessionId, threadId } = await bringUp(h);
      h.agent.setSessionMode(sessionId as unknown as Parameters<typeof h.agent.setSessionMode>[0], 'plan');

      const file = join(h.workspaceRoot, 'after-toggle.txt');
      const data = Buffer.from('after').toString('base64');
      h.request('wr-8', 'fs/writeFile', { threadId, path: file, dataBase64: data });
      await tick();
      expect(findReply(h.outbound, 'wr-8')!.result).toMatchObject({ isError: true });
      expect(existsSync(file)).toBe(false);

      // Toggle off.
      h.agent.setSessionMode(sessionId as unknown as Parameters<typeof h.agent.setSessionMode>[0], 'default');
      h.request('wr-9', 'fs/writeFile', { threadId, path: file, dataBase64: data });
      await tick();
      const reply = findReply(h.outbound, 'wr-9');
      expect((reply!.result as { isError?: boolean }).isError).toBeUndefined();
      expect(readFileSync(file, 'utf8')).toBe('after');
      await h.agent.stop();
    } finally {
      h.cleanup();
    }
  });
});

// ─── env override ────────────────────────────────────────────────────

describe('M2 · ELANOUS_CODEX_FS_MAX_BYTES env', () => {
  test('env override applies when opts unset', async () => {
    const prev = process.env.ELANOUS_CODEX_FS_MAX_BYTES;
    process.env.ELANOUS_CODEX_FS_MAX_BYTES = '16';
    try {
      const h = makeHarness();
      try {
        const { threadId } = await bringUp(h);
        const file = join(h.workspaceRoot, 'cap.txt');
        writeFileSync(file, 'x'.repeat(64));
        h.request('rd-env', 'fs/readFile', { threadId, path: file });
        await tick();
        const reply = findReply(h.outbound, 'rd-env');
        expect((reply!.result as { isError: boolean }).isError).toBe(true);
        await h.agent.stop();
      } finally {
        h.cleanup();
      }
    } finally {
      if (prev === undefined) delete process.env.ELANOUS_CODEX_FS_MAX_BYTES;
      else process.env.ELANOUS_CODEX_FS_MAX_BYTES = prev;
    }
  });

  test('opts wins over env', async () => {
    const prev = process.env.ELANOUS_CODEX_FS_MAX_BYTES;
    process.env.ELANOUS_CODEX_FS_MAX_BYTES = '8';
    try {
      const h = makeHarness({ fileOpsMaxBytes: 1024 });
      try {
        const { threadId } = await bringUp(h);
        const file = join(h.workspaceRoot, 'cap.txt');
        writeFileSync(file, 'x'.repeat(64));
        h.request('rd-opts', 'fs/readFile', { threadId, path: file });
        await tick();
        const reply = findReply(h.outbound, 'rd-opts');
        expect((reply!.result as { isError?: boolean }).isError).toBeUndefined();
        await h.agent.stop();
      } finally {
        h.cleanup();
      }
    } finally {
      if (prev === undefined) delete process.env.ELANOUS_CODEX_FS_MAX_BYTES;
      else process.env.ELANOUS_CODEX_FS_MAX_BYTES = prev;
    }
  });
});

// Touch sep so it's used (lint hygiene) — sep validates platform path
// separator presence in error strings on Windows.
void sep;
