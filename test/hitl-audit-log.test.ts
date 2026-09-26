// cv-3 β-4 (Round 2 · 2026-05-08) — HITL audit log primitive.
//
// Verifies the file-backed writer + reader + concurrent-append
// safety + 100 MB rotation behaviour, plus the module-level hook
// register/clear API used by confirm.ts.

import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, statSync, existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  createFileAuditWriter,
  readAuditLog,
  registerHitlAuditHook,
  getHitlAuditHook,
  installFileAuditHook,
  defaultAuditLogPath,
  type HitlAuditEntry,
} from '../src/hitl/audit-log.js';

let cleanupDirs: string[] = [];
afterEach(() => {
  for (const d of cleanupDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  cleanupDirs = [];
  // Always reset the global hook so tests don't leak.
  registerHitlAuditHook(null);
});

function makeTmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'hitl-audit-'));
  cleanupDirs.push(d);
  return d;
}

const sampleEntry = (over: Partial<HitlAuditEntry> = {}): HitlAuditEntry => ({
  ts: Date.now(),
  requestId: 'req-1',
  prompt: 'Approve workflow X?',
  detail: 'Run id 42',
  channel: 'pushcut',
  answer: true,
  elapsedMs: 1234,
  agentKind: 'workflow',
  runId: 'run-42',
  ...over,
});

describe('audit-log — file writer happy path', () => {
  it('appends a single entry as line-delimited JSON', async () => {
    const dir = makeTmp();
    const path = join(dir, 'hitl-log.jsonl');
    const w = createFileAuditWriter({ path });
    await w.append(sampleEntry({ requestId: 'a' }));
    const lines = await readAuditLog({ path });
    expect(lines).toHaveLength(1);
    expect(lines[0].requestId).toBe('a');
    expect(lines[0].channel).toBe('pushcut');
    expect(lines[0].answer).toBe(true);
  });

  it('appends multiple entries preserving order', async () => {
    const dir = makeTmp();
    const path = join(dir, 'hitl-log.jsonl');
    const w = createFileAuditWriter({ path });
    await w.append(sampleEntry({ requestId: 'a', ts: 1000 }));
    await w.append(sampleEntry({ requestId: 'b', ts: 2000 }));
    await w.append(sampleEntry({ requestId: 'c', ts: 3000 }));
    const lines = await readAuditLog({ path });
    expect(lines.map((l) => l.requestId)).toEqual(['a', 'b', 'c']);
  });

  it('auto-creates the parent directory', async () => {
    const dir = makeTmp();
    const path = join(dir, 'nested', 'deep', 'hitl-log.jsonl');
    const w = createFileAuditWriter({ path });
    await w.append(sampleEntry());
    expect(existsSync(path)).toBe(true);
  });

  it('exposes the resolved path on the writer', () => {
    const dir = makeTmp();
    const path = join(dir, 'hitl-log.jsonl');
    expect(createFileAuditWriter({ path }).path).toBe(path);
  });
});

describe('audit-log — concurrent appends serialise cleanly', () => {
  it('100 parallel appends produce 100 well-formed lines', async () => {
    const dir = makeTmp();
    const path = join(dir, 'hitl-log.jsonl');
    const w = createFileAuditWriter({ path });
    const promises: Promise<void>[] = [];
    for (let i = 0; i < 100; i++) {
      promises.push(w.append(sampleEntry({ requestId: `r-${i}`, ts: 1000 + i })));
    }
    await Promise.all(promises);
    const lines = await readAuditLog({ path });
    expect(lines).toHaveLength(100);
    // Every parsed line is valid (no torn JSON across boundaries)
    expect(new Set(lines.map((l) => l.requestId)).size).toBe(100);
  });
});

describe('audit-log — rotation', () => {
  it('rotates to <path>.1 when active file exceeds maxBytes', async () => {
    const dir = makeTmp();
    const path = join(dir, 'hitl-log.jsonl');
    // Each entry serialises to ~150-200 bytes; cap at 500 so 3 entries
    // already trip rotation on the 3rd append.
    const w = createFileAuditWriter({ path, maxBytes: 500 });
    await w.append(sampleEntry({ requestId: 'pre-1' }));
    await w.append(sampleEntry({ requestId: 'pre-2' }));
    const sizeBeforeRotate = statSync(path).size;
    expect(sizeBeforeRotate).toBeGreaterThan(0);

    // This append should rotate the existing file to <path>.1 and
    // start a fresh file containing only this entry.
    await w.append(sampleEntry({ requestId: 'post-rotate' }));

    expect(existsSync(`${path}.1`)).toBe(true);
    const fresh = await readAuditLog({ path });
    expect(fresh).toHaveLength(1);
    expect(fresh[0].requestId).toBe('post-rotate');

    const rotated = await readAuditLog({ path: `${path}.1` });
    expect(rotated.map((l) => l.requestId)).toEqual(['pre-1', 'pre-2']);
  });

  it('readAuditLog includeRotated: true → chronological merge', async () => {
    const dir = makeTmp();
    const path = join(dir, 'hitl-log.jsonl');
    const w = createFileAuditWriter({ path, maxBytes: 400 });
    await w.append(sampleEntry({ requestId: 'a' }));
    await w.append(sampleEntry({ requestId: 'b' }));
    await w.append(sampleEntry({ requestId: 'c' }));   // triggers rotation

    const all = await readAuditLog({ path, includeRotated: true });
    expect(all.map((l) => l.requestId)).toEqual(['a', 'b', 'c']);
  });

  it('maxBytes=0 disables rotation', async () => {
    const dir = makeTmp();
    const path = join(dir, 'hitl-log.jsonl');
    const w = createFileAuditWriter({ path, maxBytes: 0 });
    for (let i = 0; i < 10; i++) {
      await w.append(sampleEntry({ requestId: `r-${i}` }));
    }
    expect(existsSync(`${path}.1`)).toBe(false);
    const all = await readAuditLog({ path });
    expect(all).toHaveLength(10);
  });
});

describe('audit-log — reader robustness', () => {
  it('skips corrupt lines silently', async () => {
    const dir = makeTmp();
    const path = join(dir, 'hitl-log.jsonl');
    const goodLine = JSON.stringify(sampleEntry({ requestId: 'good' })) + '\n';
    const badLine = '{not really json,,,\n';
    writeFileSync(path, goodLine + badLine + goodLine, 'utf-8');
    const lines = await readAuditLog({ path });
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.requestId === 'good')).toBe(true);
  });

  it('returns [] when the file does not exist', async () => {
    const dir = makeTmp();
    const path = join(dir, 'never-created.jsonl');
    const lines = await readAuditLog({ path });
    expect(lines).toEqual([]);
  });

  it('limit tails the most recent N entries', async () => {
    const dir = makeTmp();
    const path = join(dir, 'hitl-log.jsonl');
    const w = createFileAuditWriter({ path });
    for (let i = 0; i < 10; i++) {
      await w.append(sampleEntry({ requestId: `r-${i}` }));
    }
    const tail3 = await readAuditLog({ path, limit: 3 });
    expect(tail3.map((l) => l.requestId)).toEqual(['r-7', 'r-8', 'r-9']);
  });
});

describe('audit-log — module-level hook register/clear', () => {
  it('registerHitlAuditHook installs + clears the hook', () => {
    expect(getHitlAuditHook()).toBeNull();
    const fn = () => {};
    registerHitlAuditHook(fn);
    expect(getHitlAuditHook()).toBe(fn);
    registerHitlAuditHook(null);
    expect(getHitlAuditHook()).toBeNull();
  });

  it('installFileAuditHook wires a writer that the hook can use', async () => {
    const dir = makeTmp();
    const path = join(dir, 'hitl-log.jsonl');
    installFileAuditHook({ path });
    const hook = getHitlAuditHook();
    expect(hook).not.toBeNull();
    await hook!(sampleEntry({ requestId: 'via-hook' }));
    const lines = await readAuditLog({ path });
    expect(lines).toHaveLength(1);
    expect(lines[0].requestId).toBe('via-hook');
  });
});

describe('audit-log — defaultAuditLogPath', () => {
  it('honors ELANOUS_DIR env override', () => {
    const old = process.env['ELANOUS_DIR'];
    try {
      process.env['ELANOUS_DIR'] = '/tmp/test-elanous-dir';
      expect(defaultAuditLogPath()).toBe('/tmp/test-elanous-dir/hitl-log.jsonl');
    } finally {
      if (old === undefined) delete process.env['ELANOUS_DIR'];
      else process.env['ELANOUS_DIR'] = old;
    }
  });

  it('falls back to ~/.elanous/hitl-log.jsonl when ELANOUS_DIR is unset', () => {
    const old = process.env['ELANOUS_DIR'];
    try {
      delete process.env['ELANOUS_DIR'];
      const p = defaultAuditLogPath();
      expect(p.endsWith('/.elanous/hitl-log.jsonl')).toBe(true);
    } finally {
      if (old !== undefined) process.env['ELANOUS_DIR'] = old;
    }
  });
});
