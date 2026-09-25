import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  checkPwaStaleness,
  latestMtimeInDir,
  latestSourceMtime,
  latestOutMtime,
} from '../src/cli/pwa-staleness.js';

function tsec(epochMs: number): [Date, Date] {
  const d = new Date(epochMs);
  return [d, d];
}

describe('latestMtimeInDir', () => {
  let root = '';
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'staleness-')); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  test('returns 0 for missing dir', () => {
    expect(latestMtimeInDir(join(root, 'nope'))).toBe(0);
  });

  test('returns the newest mtime across nested files', () => {
    mkdirSync(join(root, 'a/b/c'), { recursive: true });
    writeFileSync(join(root, 'a/old.txt'), '1');
    utimesSync(join(root, 'a/old.txt'), ...tsec(1000));
    writeFileSync(join(root, 'a/b/mid.txt'), '2');
    utimesSync(join(root, 'a/b/mid.txt'), ...tsec(5000));
    writeFileSync(join(root, 'a/b/c/new.txt'), '3');
    utimesSync(join(root, 'a/b/c/new.txt'), ...tsec(9000));
    expect(latestMtimeInDir(root)).toBe(9000);
  });
});

describe('checkPwaStaleness', () => {
  let root = '';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pwacheck-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'public'), { recursive: true });
    mkdirSync(join(root, 'out'), { recursive: true });
    writeFileSync(join(root, 'src/page.tsx'), '// page');
    writeFileSync(join(root, 'public/icon.png'), '');
    writeFileSync(join(root, 'next.config.ts'), 'export default {};');
    writeFileSync(join(root, 'package.json'), '{}');
    writeFileSync(join(root, 'out/index.html'), '<html></html>');
  });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  test('fresh when out/ newer than source', () => {
    utimesSync(join(root, 'src/page.tsx'), ...tsec(1000));
    utimesSync(join(root, 'public/icon.png'), ...tsec(1000));
    utimesSync(join(root, 'next.config.ts'), ...tsec(1000));
    utimesSync(join(root, 'package.json'), ...tsec(1000));
    utimesSync(join(root, 'out/index.html'), ...tsec(5000));
    const v = checkPwaStaleness(root);
    expect(v.stale).toBe(false);
    expect(v.reason).toBe('fresh');
  });

  test('stale when source newer than out/', () => {
    utimesSync(join(root, 'out/index.html'), ...tsec(1000));
    utimesSync(join(root, 'src/page.tsx'), ...tsec(5000));
    utimesSync(join(root, 'public/icon.png'), ...tsec(2000));
    utimesSync(join(root, 'next.config.ts'), ...tsec(2000));
    utimesSync(join(root, 'package.json'), ...tsec(2000));
    const v = checkPwaStaleness(root);
    expect(v.stale).toBe(true);
    expect(v.reason).toBe('source-newer');
  });

  test('stale when out/ is empty (first build)', () => {
    rmSync(join(root, 'out'), { recursive: true, force: true });
    const v = checkPwaStaleness(root);
    expect(v.stale).toBe(true);
    expect(v.reason).toBe('out-missing');
  });

  test('latestSourceMtime picks the newest of src / public / config files', () => {
    utimesSync(join(root, 'src/page.tsx'), ...tsec(1000));
    utimesSync(join(root, 'public/icon.png'), ...tsec(2000));
    utimesSync(join(root, 'next.config.ts'), ...tsec(7777));
    utimesSync(join(root, 'package.json'), ...tsec(3000));
    expect(latestSourceMtime(root)).toBe(7777);
  });

  test('latestOutMtime returns 0 when out/ absent', () => {
    rmSync(join(root, 'out'), { recursive: true, force: true });
    expect(latestOutMtime(root)).toBe(0);
  });
});
