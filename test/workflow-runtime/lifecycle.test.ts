// M4-6 (2026-05-12) — workflow lifecycle store unit tests.

import { describe, expect, test } from 'bun:test';

import {
  clearWorkflowLifecycle,
  listWorkflowLifecycle,
  readWorkflowLifecycle,
  setWorkflowLifecycle,
  isWorkflowLifecycleStatus,
  WORKFLOW_LIFECYCLE_STATUSES,
} from '../../src/workflow-runtime/lifecycle.ts';

function makeMemoryFs(): {
  files: Map<string, string>;
  reads: number;
  writes: number;
  readFile: (path: string) => string;
  writeFile: (path: string, content: string) => void;
  resolveDir: () => string;
  now: () => number;
} {
  const files = new Map<string, string>();
  let reads = 0;
  let writes = 0;
  let nowMs = 1_700_000_000_000;
  return {
    files,
    get reads() { return reads; },
    get writes() { return writes; },
    readFile: (path: string) => {
      reads += 1;
      const v = files.get(path);
      if (v === undefined) throw new Error(`no such file: ${path}`);
      return v;
    },
    writeFile: (path: string, content: string) => {
      writes += 1;
      files.set(path, content);
    },
    resolveDir: () => '/fake/workflows',
    now: () => {
      nowMs += 1_000;
      return nowMs;
    },
  };
}

describe('isWorkflowLifecycleStatus', () => {
  test('accepts the closed set', () => {
    for (const s of WORKFLOW_LIFECYCLE_STATUSES) {
      expect(isWorkflowLifecycleStatus(s)).toBe(true);
    }
    expect(isWorkflowLifecycleStatus('archived')).toBe(false);
    expect(isWorkflowLifecycleStatus(undefined)).toBe(false);
  });
});

describe('readWorkflowLifecycle', () => {
  test('missing file → "active"', () => {
    const fs = makeMemoryFs();
    expect(readWorkflowLifecycle('foo', fs)).toBe('active');
  });

  test('missing entry within file → "active"', () => {
    const fs = makeMemoryFs();
    fs.files.set('/fake/workflows/.lifecycle.json', JSON.stringify({
      version: 1,
      status: { other: 'draft' },
      updatedAt: '2026-05-12T00:00:00Z',
    }));
    expect(readWorkflowLifecycle('foo', fs)).toBe('active');
  });

  test('explicit entry round-trips through the store', () => {
    const fs = makeMemoryFs();
    setWorkflowLifecycle('foo', 'draft', fs);
    expect(readWorkflowLifecycle('foo', fs)).toBe('draft');
    setWorkflowLifecycle('foo', 'active', fs);
    expect(readWorkflowLifecycle('foo', fs)).toBe('active');
  });

  test('malformed file → "active" (graceful)', () => {
    const fs = makeMemoryFs();
    fs.files.set('/fake/workflows/.lifecycle.json', 'garbage');
    expect(readWorkflowLifecycle('foo', fs)).toBe('active');
  });

  test('unknown version → "active" (forward-compat)', () => {
    const fs = makeMemoryFs();
    fs.files.set('/fake/workflows/.lifecycle.json', JSON.stringify({
      version: 99,
      status: { foo: 'draft' },
    }));
    expect(readWorkflowLifecycle('foo', fs)).toBe('active');
  });
});

describe('setWorkflowLifecycle', () => {
  test('first write → previous is undefined; subsequent → captured', () => {
    const fs = makeMemoryFs();
    const a = setWorkflowLifecycle('foo', 'draft', fs);
    expect(a.ok).toBe(true);
    expect(a.previous).toBeUndefined();
    const b = setWorkflowLifecycle('foo', 'active', fs);
    expect(b.previous).toBe('draft');
  });

  test('idempotent — same status twice still bumps updatedAt', () => {
    const fs = makeMemoryFs();
    const a = setWorkflowLifecycle('foo', 'draft', fs);
    const b = setWorkflowLifecycle('foo', 'draft', fs);
    expect(b.updatedAt).not.toBe(a.updatedAt);
  });

  test('empty workflow name rejected (ok:false)', () => {
    const fs = makeMemoryFs();
    const r = setWorkflowLifecycle('', 'draft', fs);
    expect(r.ok).toBe(false);
  });
});

describe('listWorkflowLifecycle', () => {
  test('missing file → empty object', () => {
    const fs = makeMemoryFs();
    expect(listWorkflowLifecycle(fs)).toEqual({});
  });

  test('returns the full status map', () => {
    const fs = makeMemoryFs();
    setWorkflowLifecycle('foo', 'draft', fs);
    setWorkflowLifecycle('bar', 'active', fs);
    setWorkflowLifecycle('baz', 'draft', fs);
    expect(listWorkflowLifecycle(fs)).toEqual({
      foo: 'draft',
      bar: 'active',
      baz: 'draft',
    });
  });
});

describe('clearWorkflowLifecycle', () => {
  test('removes explicit entry → readBack returns "active" (default)', () => {
    const fs = makeMemoryFs();
    setWorkflowLifecycle('foo', 'draft', fs);
    expect(readWorkflowLifecycle('foo', fs)).toBe('draft');
    expect(clearWorkflowLifecycle('foo', fs)).toBe(true);
    expect(readWorkflowLifecycle('foo', fs)).toBe('active');
  });

  test('returns false when entry already absent', () => {
    const fs = makeMemoryFs();
    expect(clearWorkflowLifecycle('foo', fs)).toBe(false);
  });
});
