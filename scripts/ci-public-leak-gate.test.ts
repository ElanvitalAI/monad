import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { countByMarkerAndFile, findGrowth, parseBaseline, renderBaseline, runPublicLeakGate } from './ci-public-leak-gate.js';
import type { LeakHit } from './public-export.js';

const hit = (marker: string, file: string): LeakHit => ({ marker, file, line: 1, text: '' });

function rootWithScripts(): string {
  const root = mkdtempSync(join(tmpdir(), 'leak-gate-'));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  return root;
}

function capture() {
  const out: string[] = [];
  return { out, log: (s: string) => out.push(s), error: (s: string) => out.push(s) };
}

describe('ci-public-leak-gate', () => {
  test('baseline round-trips and only a count above the baseline is growth', () => {
    const counts = countByMarkerAndFile([hit('ceo-mark', 'src/a.ts'), hit('ceo-mark', 'src/a.ts'), hit('pilot-tree', 'src/b.ts')]);
    const baseline = parseBaseline(renderBaseline(counts));
    expect(baseline).toEqual(counts);
    expect(findGrowth(counts, baseline)).toEqual([]);
    const grown = countByMarkerAndFile([hit('ceo-mark', 'src/a.ts'), hit('ceo-mark', 'src/a.ts'), hit('ceo-mark', 'src/a.ts'), hit('ceo-mark', 'src/new.ts')]);
    expect(findGrowth(grown, baseline)).toEqual([
      { marker: 'ceo-mark', file: 'src/a.ts', allowed: 2, now: 3 },
      { marker: 'ceo-mark', file: 'src/new.ts', allowed: 0, now: 1 },
    ]);
  });

  test('--update writes the baseline; a later grown scan fails, a shrunk scan passes, --changed-files narrows', () => {
    const root = rootWithScripts();
    let hits = [hit('ceo-mark', 'src/a.ts')];
    const io = (args: string[]) => { const c = capture(); return { rc: runPublicLeakGate({ args, root, scan: () => hits, log: c.log, error: c.error }), out: c.out.join('\n') }; };
    expect(io(['--update']).rc).toBe(0);
    expect(readFileSync(join(root, 'scripts/public-leak-baseline.txt'), 'utf8')).toContain('1\tceo-mark\tsrc/a.ts');
    hits = [hit('ceo-mark', 'src/a.ts'), hit('absolute-home-path', 'src/b.ts')];
    const grown = io([]);
    expect(grown.rc).toBe(1);
    expect(grown.out).toContain('src/b.ts  absolute-home-path  0 → 1');
    expect(io(['--changed-files', 'src/a.ts']).rc).toBe(0);   // 늘어난 파일이 변경 목록 밖
    hits = [];
    expect(io([]).rc).toBe(0);
  });

  test('a missing baseline is «cannot judge» (rc 2), not a pass', () => {
    const root = rootWithScripts();
    const c = capture();
    expect(runPublicLeakGate({ args: [], root, scan: () => [], log: c.log, error: c.error })).toBe(2);
    writeFileSync(join(root, 'x'), '');
  });
});
