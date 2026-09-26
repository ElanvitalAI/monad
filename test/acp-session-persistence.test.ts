// Unit tests for ACP session persistence — H2 #5.
//
// Uses an injected in-memory fs so tests don't hit real disk and
// stay deterministic. Also drives the round-trip via the same JSON
// shape the production path writes.

import { describe, expect, test } from 'bun:test';
import {
  createAcpSessionPersistence,
  type AcpSessionPersistenceFs,
  type PersistedAcpSession,
} from '../src/acp/session-persistence.js';
import type { ContentBlock } from '@agentclientprotocol/sdk';

interface MemFs extends AcpSessionPersistenceFs {
  readonly files: Map<string, string>;
  readonly dirs: Set<string>;
}

function makeMemFs(): MemFs {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  return {
    files,
    dirs,
    existsSync(path) { return files.has(path) || dirs.has(path); },
    readFileSync(path) {
      const f = files.get(path);
      if (f === undefined) throw new Error(`ENOENT: ${path}`);
      return f;
    },
    writeFileSync(path, contents) { files.set(path, contents); },
    renameSync(from, to) {
      const f = files.get(from);
      if (f === undefined) throw new Error(`ENOENT: ${from}`);
      files.set(to, f);
      files.delete(from);
    },
    readdirSync(path) {
      const prefix = path.endsWith('/') ? path : `${path}/`;
      const out: string[] = [];
      for (const p of files.keys()) {
        if (p.startsWith(prefix)) {
          const rest = p.slice(prefix.length);
          if (!rest.includes('/')) out.push(rest);
        }
      }
      return out;
    },
    unlinkSync(path) {
      if (!files.delete(path)) throw new Error(`ENOENT: ${path}`);
    },
    mkdirSync(path) { dirs.add(path); },
  };
}

function sampleRecord(
  overrides: Partial<Omit<PersistedAcpSession, 'lastSeenAt' | 'createdAt'>> = {},
): Omit<PersistedAcpSession, 'lastSeenAt' | 'createdAt'> {
  return {
    sessionId: 'acp-cli:claude:s-1',
    backendSessionId: 's-1',
    backendId: 'claude',
    cwd: '/tmp',
    protocolVersion: 1,
    history: [],
    planSnapshot: null,
    toolCalls: [],
    ...overrides,
  };
}

function makePersistence(base = '/cfg/elanous/acp-sessions', clock?: { ticks: number[] }) {
  const fs = makeMemFs();
  let i = 0;
  const p = createAcpSessionPersistence({
    basePath: base,
    fs,
    now: clock ? () => clock.ticks[i++ % clock.ticks.length] ?? 1 : () => 1000,
  });
  return { p, fs };
}

describe('createAcpSessionPersistence · persist/load round-trip', () => {
  test('full payload preserved across persist+load', () => {
    const { p } = makePersistence();
    const history: ContentBlock[] = [{ type: 'text', text: 'hello' }];
    const written = p.persist(sampleRecord({ history, origin: 'chat-42' }));
    expect(written.history).toEqual(history);
    const loaded = p.load('acp-cli:claude:s-1');
    expect(loaded).not.toBeNull();
    expect(loaded!.history).toEqual(history);
    expect(loaded!.backendSessionId).toBe('s-1');
    expect(loaded!.origin).toBe('chat-42');
  });

  test('persist bumps lastSeenAt on second write', () => {
    const clock = { ticks: [1000, 2000, 3000] };
    const { p } = makePersistence('/cfg', clock);
    const w1 = p.persist(sampleRecord());
    const w2 = p.persist(sampleRecord());
    expect(w2.lastSeenAt).toBeGreaterThan(w1.lastSeenAt);
  });

  test('persist preserves original createdAt on subsequent writes', () => {
    const clock = { ticks: [1000, 2000, 3000, 4000] };
    const { p } = makePersistence('/cfg', clock);
    const w1 = p.persist(sampleRecord());
    const createdAt1 = w1.createdAt;
    const w2 = p.persist(sampleRecord());
    expect(w2.createdAt).toBe(createdAt1);
  });

  test('missing base dir is created on first persist', () => {
    const { p, fs } = makePersistence('/fresh/dir');
    expect(fs.dirs.has('/fresh/dir')).toBe(false);
    p.persist(sampleRecord());
    expect(fs.dirs.has('/fresh/dir')).toBe(true);
  });

  test('custom basePath is respected', () => {
    const { p, fs } = makePersistence('/custom/path');
    p.persist(sampleRecord());
    const files = Array.from(fs.files.keys());
    expect(files[0]).toContain('/custom/path/');
  });

  test('sanitizes sessionId characters for filename', () => {
    const { p, fs } = makePersistence('/cfg');
    p.persist(sampleRecord({ sessionId: 'weird:id/with spaces' }));
    const files = Array.from(fs.files.keys());
    // All colons, slashes, spaces replaced
    const name = files[0]!.split('/').pop() ?? '';
    expect(name).not.toContain(':');
    expect(name).not.toContain(' ');
    expect(name.endsWith('.json')).toBe(true);
  });

  test('persist with null planSnapshot round-trips', () => {
    const { p } = makePersistence();
    p.persist(sampleRecord({ planSnapshot: null }));
    const loaded = p.load('acp-cli:claude:s-1');
    expect(loaded!.planSnapshot).toBeNull();
  });

  test('persist with large history (100 blocks) round-trips', () => {
    const { p } = makePersistence();
    const history: ContentBlock[] = Array.from({ length: 100 }, (_, i) => ({
      type: 'text',
      text: `block ${i}`,
    }));
    p.persist(sampleRecord({ history }));
    const loaded = p.load('acp-cli:claude:s-1');
    expect(loaded!.history).toHaveLength(100);
    expect(loaded!.history[99]).toEqual({ type: 'text', text: 'block 99' });
  });
});

describe('createAcpSessionPersistence · load', () => {
  test('load unknown id returns null', () => {
    const { p } = makePersistence();
    expect(p.load('nope')).toBeNull();
  });

  test('load corrupt JSON returns null (not thrown)', () => {
    const { p, fs } = makePersistence('/cfg');
    fs.files.set('/cfg/acp-cli_claude_s-1.json', '{ this is not json');
    expect(p.load('acp-cli:claude:s-1')).toBeNull();
  });

  test('load malformed (missing field) returns null', () => {
    const { p, fs } = makePersistence('/cfg');
    fs.files.set('/cfg/acp-cli_claude_s-1.json', JSON.stringify({
      sessionId: 'x', // missing other required fields
    }));
    expect(p.load('acp-cli:claude:s-1')).toBeNull();
  });
});

describe('createAcpSessionPersistence · list', () => {
  test('empty store returns []', () => {
    const { p } = makePersistence();
    expect(p.list()).toEqual([]);
  });

  test('returns all records without filter', () => {
    const clock = { ticks: [1, 2, 3, 4, 5, 6] };
    const { p } = makePersistence('/cfg', clock);
    p.persist(sampleRecord({ sessionId: 'a', backendSessionId: 'a' }));
    p.persist(sampleRecord({ sessionId: 'b', backendSessionId: 'b', backendId: 'codex' }));
    p.persist(sampleRecord({ sessionId: 'c', backendSessionId: 'c' }));
    expect(p.list()).toHaveLength(3);
  });

  test('filters by backendId', () => {
    const { p } = makePersistence();
    p.persist(sampleRecord({ sessionId: 'a', backendSessionId: 'a' })); // claude
    p.persist(sampleRecord({ sessionId: 'b', backendSessionId: 'b', backendId: 'codex' }));
    p.persist(sampleRecord({ sessionId: 'c', backendSessionId: 'c', backendId: 'gemini' }));
    const claudeOnly = p.list({ backendId: 'claude' });
    expect(claudeOnly).toHaveLength(1);
    expect(claudeOnly[0]?.sessionId).toBe('a');
  });

  test('sorts by lastSeenAt descending', () => {
    const clock = { ticks: [1, 2, 3] };
    const { p } = makePersistence('/cfg', clock);
    p.persist(sampleRecord({ sessionId: 'a', backendSessionId: 'a' }));
    p.persist(sampleRecord({ sessionId: 'b', backendSessionId: 'b' }));
    p.persist(sampleRecord({ sessionId: 'c', backendSessionId: 'c' }));
    const listed = p.list().map((r) => r.sessionId);
    expect(listed[0]).toBe('c');
    expect(listed[2]).toBe('a');
  });

  test('skips non-.json files in the base dir', () => {
    const { p, fs } = makePersistence('/cfg');
    p.persist(sampleRecord());
    fs.files.set('/cfg/README.md', 'documentation');
    const listed = p.list();
    expect(listed).toHaveLength(1);
  });
});

describe('createAcpSessionPersistence · remove', () => {
  test('removes existing record', () => {
    const { p } = makePersistence();
    p.persist(sampleRecord());
    expect(p.remove('acp-cli:claude:s-1')).toBe(true);
    expect(p.load('acp-cli:claude:s-1')).toBeNull();
    expect(p.list()).toHaveLength(0);
  });

  test('unknown id returns false (not thrown)', () => {
    const { p } = makePersistence();
    expect(p.remove('ghost')).toBe(false);
  });
});

describe('createAcpSessionPersistence · atomic write', () => {
  test('writes go through tmp file + rename (no partial file)', () => {
    const { p, fs } = makePersistence('/cfg');
    const origRename = fs.renameSync.bind(fs);
    let sawTmp = false;
    fs.renameSync = (from, to) => {
      if (from.includes('.tmp-')) sawTmp = true;
      origRename(from, to);
    };
    p.persist(sampleRecord());
    expect(sawTmp).toBe(true);
    // After rename, final file present, tmp absent.
    const files = Array.from(fs.files.keys());
    expect(files.some((f) => f.includes('.tmp-'))).toBe(false);
    expect(files.some((f) => f.endsWith('.json'))).toBe(true);
  });
});
