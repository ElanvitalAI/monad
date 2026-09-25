// H4 Phase 3.B.2b · codex-app-server-thread-index.ts unit tests.
// Pattern mirrors test/acp-codex-native-thread-index.test.ts (H4 P2).

import { describe, test, expect } from 'bun:test';
import {
  createCasThreadIndex,
  CAS_THREAD_INDEX_MAX,
  type CasThreadIndexEntry,
  type CasThreadIndexFs,
} from '../src/acp/codex-app-server-thread-index.js';

/** In-memory fs stub · simulates readFileSync/writeFileSync with a Map
 *  so tests don't touch disk. Treats `renameSync` as a copy-and-delete
 *  so atomic writes pass through correctly. */
function memFs(): { fs: CasThreadIndexFs; files: Map<string, string> } {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  return {
    files,
    fs: {
      existsSync: (p) => files.has(p) || dirs.has(p),
      readFileSync: (p) => {
        const v = files.get(p);
        if (v === undefined) throw new Error(`ENOENT ${p}`);
        return v;
      },
      writeFileSync: (p, c) => { files.set(p, c); },
      renameSync: (from, to) => {
        const v = files.get(from);
        if (v === undefined) throw new Error(`rename missing ${from}`);
        files.set(to, v);
        files.delete(from);
      },
      mkdirSync: (p) => { dirs.add(p); },
    },
  };
}

describe('createCasThreadIndex', () => {
  test('get on empty index → null', () => {
    const { fs } = memFs();
    const idx = createCasThreadIndex({ basePath: '/mem/ix.json', fs });
    expect(idx.get('missing')).toBeNull();
  });

  test('put + get round-trip + persists to disk', () => {
    const { fs, files } = memFs();
    const idx = createCasThreadIndex({ basePath: '/mem/ix.json', fs, now: () => 123 });
    const entry = idx.put('synth-1', { threadId: 'thr-a', cwd: '/work' });
    expect(entry.synthId).toBe('synth-1');
    expect(entry.threadId).toBe('thr-a');
    expect(entry.createdAt).toBe(123);
    expect(entry.lastTurnAt).toBe(123);
    expect(files.has('/mem/ix.json')).toBe(true);
    const reread = idx.get('synth-1');
    expect(reread!.threadId).toBe('thr-a');
  });

  test('touch updates lastTurnAt only · keeps createdAt', () => {
    const { fs } = memFs();
    let tick = 100;
    const idx = createCasThreadIndex({ basePath: '/mem/ix.json', fs, now: () => tick });
    idx.put('synth-1', { threadId: 'thr', cwd: '/w' });
    tick = 200;
    const touched = idx.touch('synth-1');
    expect(touched!.lastTurnAt).toBe(200);
    expect(touched!.createdAt).toBe(100);
  });

  test('touch on missing id → null', () => {
    const { fs } = memFs();
    const idx = createCasThreadIndex({ basePath: '/mem/ix.json', fs });
    expect(idx.touch('nope')).toBeNull();
  });

  test('remove drops the entry', () => {
    const { fs } = memFs();
    const idx = createCasThreadIndex({ basePath: '/mem/ix.json', fs });
    idx.put('synth-1', { threadId: 'thr', cwd: '/w' });
    expect(idx.remove('synth-1')).toBe(true);
    expect(idx.get('synth-1')).toBeNull();
    expect(idx.remove('synth-1')).toBe(false);
  });

  test('list returns newest-first by lastTurnAt', () => {
    const { fs } = memFs();
    let tick = 1000;
    const idx = createCasThreadIndex({ basePath: '/mem/ix.json', fs, now: () => tick });
    idx.put('a', { threadId: 'ta', cwd: '/w' });
    tick = 2000;
    idx.put('b', { threadId: 'tb', cwd: '/w' });
    tick = 3000;
    idx.put('c', { threadId: 'tc', cwd: '/w' });
    const items = idx.list().map((e) => e.synthId);
    expect(items).toEqual(['c', 'b', 'a']);
  });

  test('corrupt JSON file → treated as empty (no throw)', () => {
    const { fs, files } = memFs();
    files.set('/mem/ix.json', '{not:json}');
    const idx = createCasThreadIndex({ basePath: '/mem/ix.json', fs });
    expect(idx.get('any')).toBeNull();
    // And writing on top recovers cleanly
    const e = idx.put('s1', { threadId: 't', cwd: '/w' });
    expect(e.threadId).toBe('t');
  });

  test('malformed entries are dropped on read', () => {
    const { fs, files } = memFs();
    const valid: CasThreadIndexEntry = {
      synthId: 'ok', threadId: 't', cwd: '/w',
      createdAt: 1, lastTurnAt: 1,
    };
    files.set('/mem/ix.json', JSON.stringify({
      ok: valid,
      bad: { synthId: 'bad' /* missing fields */ },
    }));
    const idx = createCasThreadIndex({ basePath: '/mem/ix.json', fs });
    expect(idx.get('ok')).not.toBeNull();
    expect(idx.get('bad')).toBeNull();
  });

  test('atomic write: tmp file renamed to final path', () => {
    const { fs, files } = memFs();
    const idx = createCasThreadIndex({ basePath: '/mem/ix.json', fs });
    idx.put('synth-1', { threadId: 'thr', cwd: '/w' });
    // After put, tmp should no longer exist (rename consumed it).
    const tmpKeys = [...files.keys()].filter((k) => k.startsWith('/mem/ix.json.tmp-'));
    expect(tmpKeys).toHaveLength(0);
    expect(files.has('/mem/ix.json')).toBe(true);
  });

  // Fix A — LRU cap. Without it, every session mint / recycle leaves a
  // permanent orphan and the file grows forever.
  test('put evicts the least-recently-used entries past CAS_THREAD_INDEX_MAX', () => {
    const { fs } = memFs();
    let clock = 1000;
    const idx = createCasThreadIndex({ basePath: '/mem/ix.json', fs, now: () => (clock += 1) });
    const n = CAS_THREAD_INDEX_MAX + 3;
    for (let i = 0; i < n; i++) idx.put(`s${i}`, { threadId: `t${i}`, cwd: '/w' });
    // Bounded at the cap…
    expect(idx.list()).toHaveLength(CAS_THREAD_INDEX_MAX);
    // …the 3 OLDEST (lowest lastTurnAt) evicted, the newest kept.
    expect(idx.get('s0')).toBeNull();
    expect(idx.get('s1')).toBeNull();
    expect(idx.get('s2')).toBeNull();
    expect(idx.get(`s${n - 1}`)).not.toBeNull();
  });

  test('a re-put (touch via put) protects an entry from LRU eviction', () => {
    const { fs } = memFs();
    let clock = 1000;
    const idx = createCasThreadIndex({ basePath: '/mem/ix.json', fs, now: () => (clock += 1) });
    idx.put('keep', { threadId: 't', cwd: '/w' }); // oldest…
    for (let i = 0; i < CAS_THREAD_INDEX_MAX; i++) idx.put(`s${i}`, { threadId: `t${i}`, cwd: '/w' });
    idx.put('keep', { threadId: 't', cwd: '/w' }); // …but re-put → now newest, so it survives
    idx.put('overflow', { threadId: 't', cwd: '/w' }); // pushes size past cap → evicts the oldest (s0)
    expect(idx.get('keep')).not.toBeNull();
    expect(idx.get('s0')).toBeNull();
  });
});
