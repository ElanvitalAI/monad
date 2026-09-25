import { describe, expect, test } from 'bun:test';
import { groundDecomposePathClaims } from './decompose-path-grounding.js';

describe('groundDecomposePathClaims', () => {
  test('counts distinct present and missing repository path candidates', () => {
    const result = groundDecomposePathClaims(
      'Edit src/present.ts, src/missing.ts, and src/present.ts again.',
      {
        repoRoot: '/repo',
        probe: (path) => path === '/repo/src/present.ts' ? 'present' : 'missing',
      },
    );

    expect(result).toEqual({ candidateStatus: 'checked', candidateCount: 2, missingCount: 1 });
  });

  test('distinguishes no candidates from a checked fragment with no missing paths', () => {
    expect(groundDecomposePathClaims('Implement the parser.', { repoRoot: '/repo' }))
      .toEqual({ candidateStatus: 'no-candidates', candidateCount: 0, missingCount: 0 });
    expect(groundDecomposePathClaims('Edit src/present.ts', {
      repoRoot: '/repo',
      probe: () => 'present',
    })).toEqual({ candidateStatus: 'checked', candidateCount: 1, missingCount: 0 });
  });

  test('grounds a backticked path qualified by a source name through its canonical probe', () => {
    const probes: string[] = [];
    const result = groundDecomposePathClaims('Edit `src/present.ts:buildApplication`.', {
      repoRoot: '/repo',
      probe: (path) => {
        probes.push(path);
        return 'present';
      },
    });

    expect(result).toEqual({ candidateStatus: 'checked', candidateCount: 1, missingCount: 0 });
    expect(probes).toEqual(['/repo/src/present.ts']);
  });

  test('reports unavailable inspection without counting it as missing', () => {
    const result = groundDecomposePathClaims('Edit src/unreadable.ts', {
      repoRoot: '/repo',
      probe: () => 'unavailable',
    });

    expect(result).toEqual({
      candidateStatus: 'unavailable',
      candidateCount: 1,
      missingCount: 0,
      reason: '소스 경로 확인 불가 (src/unreadable.ts)',
    });
  });
});
