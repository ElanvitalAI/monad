// R6 v2 FU — day-bucket store contract.
//
// Cross-ref:
//   src/notes/day-bucket-store.ts (impl)
//   src/notes/metrics.ts (consumer · daySnapshot)
//   src/notes/daily-reflection.ts (consumer · past-date queries)

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDayBucketStore } from '../src/notes/day-bucket-store.js';

let tmp: string;
const activeBucketNow = () => new Date('2026-05-09T12:00:00Z').getTime();

// Diagnosis: this is neither a persistence failure nor a wrong storage root.
// createDayBucketStore selects explicit opts.dir before the nexusRootDir()
// chain (test-state root, config-dir override, MONAD_NEXUS_DIR, config dir),
// so tmp is the actual file location. The failures came from default trimming:
// fixed 2026-05 dates were older than its current-clock 90-day window.

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'monad-day-bucket-'));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

interface FakeS3 {
  uploads: Array<{ localPath: string; key: string }>;
  exists: Set<string>;
  // map of key → file path the next download() should copy from
  downloads: Map<string, string>;
}

function makeFakeS3(initial: Partial<FakeS3> = {}) {
  const state: FakeS3 = {
    uploads: initial.uploads ?? [],
    exists: initial.exists ?? new Set<string>(),
    downloads: initial.downloads ?? new Map<string, string>(),
  };
  return {
    state,
    transport: {
      available: () => true,
      upload: (localPath: string, key: string) => {
        state.uploads.push({ localPath, key });
        state.exists.add(key);
      },
      download: (key: string, localPath: string) => {
        const src = state.downloads.get(key);
        if (!src) throw new Error('no such key');
        const buf = readFileSync(src);
        require('node:fs').writeFileSync(localPath, buf);
      },
      objectExists: (key: string) => state.exists.has(key),
    },
  };
}

describe('createDayBucketStore · local-only behaviour', () => {
  test('bumpOcr persists + get returns the count', () => {
    const store = createDayBucketStore({ dir: tmp, s3Disabled: true, now: activeBucketNow });
    store.bumpOcr('2026-05-09', true);
    store.bumpOcr('2026-05-09', false);
    const counts = store.get('2026-05-09');
    expect(counts.ocr.total).toBe(2);
    expect(counts.ocr.failures).toBe(1);
    // Disk file written.
    expect(existsSync(join(tmp, 'notes-day-buckets.json'))).toBe(true);
  });

  test('bumpSave + bumpOcr are independent counters', () => {
    const store = createDayBucketStore({ dir: tmp, s3Disabled: true, now: activeBucketNow });
    store.bumpOcr('2026-05-09', true);
    store.bumpSave('2026-05-09', true);
    store.bumpSave('2026-05-09', false);
    const c = store.get('2026-05-09');
    expect(c.ocr.total).toBe(1);
    expect(c.save.total).toBe(2);
    expect(c.save.failures).toBe(1);
  });

  test('different dates do not interfere', () => {
    const store = createDayBucketStore({ dir: tmp, s3Disabled: true, now: activeBucketNow });
    store.bumpOcr('2026-05-08', true);
    store.bumpOcr('2026-05-09', true);
    store.bumpOcr('2026-05-09', true);
    expect(store.get('2026-05-08').ocr.total).toBe(1);
    expect(store.get('2026-05-09').ocr.total).toBe(2);
  });

  test('get on absent date returns zero counts', () => {
    const store = createDayBucketStore({ dir: tmp, s3Disabled: true });
    const c = store.get('2026-04-01');
    expect(c.ocr.total).toBe(0);
    expect(c.save.total).toBe(0);
  });

  test('store survives "restart" — second factory reads disk', () => {
    const s1 = createDayBucketStore({ dir: tmp, s3Disabled: true, now: activeBucketNow });
    s1.bumpOcr('2026-05-09', true);
    s1.bumpSave('2026-05-09', true);
    // simulate process restart
    const s2 = createDayBucketStore({ dir: tmp, s3Disabled: true, now: activeBucketNow });
    expect(s2.get('2026-05-09').ocr.total).toBe(1);
    expect(s2.get('2026-05-09').save.total).toBe(1);
  });

  test('keepDays trim drops buckets older than the window when clock advances', () => {
    // Trim runs on every write against the CURRENT clock, so to test
    // the drop we bump within-window, then advance the clock past the
    // window + bump again to trigger a re-trim.
    let nowMs = new Date('2026-05-01T12:00:00Z').getTime();
    const store = createDayBucketStore({
      dir: tmp,
      s3Disabled: true,
      keepDays: 7,
      now: () => nowMs,
    });
    store.bumpOcr('2026-05-01', true);
    expect(store.get('2026-05-01').ocr.total).toBe(1);
    // Advance clock 10 days — '2026-05-01' is now beyond 7-day window.
    nowMs = new Date('2026-05-11T12:00:00Z').getTime();
    store.bumpOcr('2026-05-11', true);
    expect(store.get('2026-05-01').ocr.total).toBe(0);
    expect(store.get('2026-05-11').ocr.total).toBe(1);
  });

  test('dates() returns active bucket keys sorted asc', () => {
    const store = createDayBucketStore({ dir: tmp, s3Disabled: true, now: activeBucketNow });
    store.bumpOcr('2026-05-08', true);
    store.bumpOcr('2026-05-07', true);
    store.bumpOcr('2026-05-09', true);
    expect(store.dates()).toEqual(['2026-05-07', '2026-05-08', '2026-05-09']);
  });

  test('returned counts are deep-cloned (mutation does not poison cache)', () => {
    const store = createDayBucketStore({ dir: tmp, s3Disabled: true, now: activeBucketNow });
    store.bumpOcr('2026-05-09', true);
    const c = store.get('2026-05-09');
    c.ocr.total = 99;
    // Re-read should still report the original.
    expect(store.get('2026-05-09').ocr.total).toBe(1);
  });
});

describe('createDayBucketStore · S3 sync', () => {
  test('bump pushes to S3', () => {
    const fake = makeFakeS3();
    const store = createDayBucketStore({
      dir: tmp,
      s3Transport: fake.transport,
    });
    store.bumpOcr('2026-05-09', true);
    expect(fake.state.uploads.length).toBe(1);
    expect(fake.state.uploads[0]!.localPath).toContain('day-buckets.json');
    // S3 key includes the canonical layout (notes-metrics + monad_id).
    expect(fake.state.uploads[0]!.key).toContain('notes-metrics/day-buckets.json');
  });

  test('S3 push failure is swallowed — local write still committed', () => {
    const fake = makeFakeS3();
    fake.transport.upload = () => { throw new Error('s3 down'); };
    const store = createDayBucketStore({
      dir: tmp,
      now: activeBucketNow,
      s3Transport: fake.transport,
    });
    store.bumpOcr('2026-05-09', true);
    // Local write committed → reading still works.
    expect(store.get('2026-05-09').ocr.total).toBe(1);
    expect(existsSync(join(tmp, 'notes-day-buckets.json'))).toBe(true);
  });

  test('boot pulls from S3 when local file missing + remote exists', () => {
    // Stage a "remote" file on disk that the fake S3 transport returns.
    const remotePath = join(tmp, 'remote-buckets.json');
    require('node:fs').writeFileSync(
      remotePath,
      JSON.stringify({
        version: 1,
        buckets: { '2026-05-08': {
          ocr: { total: 5, failures: 1 },
          save: { total: 3, failures: 0 },
        }},
      }),
    );
    const fake = makeFakeS3();
    // Pretend remote object exists; download returns the staged file.
    const remoteKey = 'monad/X/notes-metrics/day-buckets.json';
    void remoteKey;
    fake.state.exists.add(''); // any key matches because we only check
    fake.transport.objectExists = () => true;
    fake.transport.download = (_key: string, localPath: string) => {
      const buf = readFileSync(remotePath);
      require('node:fs').writeFileSync(localPath, buf);
    };

    // Use a fresh local dir (no existing day-buckets.json).
    const localDir = mkdtempSync(join(tmp, 'fresh-'));
    const store = createDayBucketStore({
      dir: localDir,
      s3Transport: fake.transport,
    });
    expect(store.get('2026-05-08').ocr.total).toBe(5);
    expect(store.get('2026-05-08').save.total).toBe(3);
  });

  test('S3 disabled flag fully bypasses uploads', () => {
    const fake = makeFakeS3();
    const store = createDayBucketStore({
      dir: tmp,
      s3Disabled: true,
      s3Transport: fake.transport,
    });
    store.bumpOcr('2026-05-09', true);
    expect(fake.state.uploads.length).toBe(0);
  });

  test('available()=false bypasses uploads', () => {
    const fake = makeFakeS3();
    fake.transport.available = () => false;
    const store = createDayBucketStore({
      dir: tmp,
      s3Transport: fake.transport,
    });
    store.bumpOcr('2026-05-09', true);
    expect(fake.state.uploads.length).toBe(0);
  });
});
