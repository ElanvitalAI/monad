// ── 신선도 재게이트 테스트 (A3 · 2026-07-13) ──────────────────────────────
// 핵심: 거리>0 자체는 stale 아님(sub8 교훈) — main 이 겹치는 파일을 바꿨을 때만 stale.

import { describe, expect, it } from 'bun:test';
import { judgeFreshness, regateFreshness, type FreshnessGit } from './freshness-regate.js';

describe('judgeFreshness', () => {
  it('base == main → fresh(거리 0)', () => {
    const v = judgeFreshness({ baseSha: 'abc', mainSha: 'abc', distance: 0, mainChangedFiles: [], phaseFiles: ['a.ts'] });
    expect(v.fresh).toBe(true);
    expect(v.staleFiles).toEqual([]);
  });

  it('★ 거리>0 이나 겹치는 파일 없음 → fresh(sub8 교훈·무관한 커밋)', () => {
    const v = judgeFreshness({
      baseSha: 'base', mainSha: 'main', distance: 3,
      mainChangedFiles: ['unrelated1.ts', 'unrelated2.ts'], phaseFiles: ['price-guard.ts', 'signal.ts'],
    });
    expect(v.fresh).toBe(true);
    expect(v.distance).toBe(3);
    expect(v.reason).toContain('겹치는 파일 0');
  });

  it('main 이 겹치는 파일 변경 → stale(rebase+rebuild)', () => {
    const v = judgeFreshness({
      baseSha: 'base', mainSha: 'main', distance: 2,
      mainChangedFiles: ['signal.ts', 'other.ts'], phaseFiles: ['price-guard.ts', 'signal.ts'],
    });
    expect(v.fresh).toBe(false);
    expect(v.staleFiles).toEqual(['signal.ts']);
    expect(v.reason).toContain('stale-base');
  });

  it('중복 제거된 겹침 파일', () => {
    const v = judgeFreshness({
      baseSha: 'b', mainSha: 'm', distance: 1,
      mainChangedFiles: ['x.ts', 'x.ts', 'y.ts'], phaseFiles: ['x.ts'],
    });
    expect(v.staleFiles).toEqual(['x.ts']);
  });
});

describe('regateFreshness (git seam)', () => {
  const fakeGit = (main: string, dist: number, changed: string[]): FreshnessGit => ({
    mainSha: () => main, distance: () => dist, mainChangedFiles: () => changed,
  });

  it('seam 주입 → 신선(겹침 없음)', () => {
    const v = regateFreshness({ baseSha: 'b1', phaseFiles: ['a.ts'], git: fakeGit('m1', 5, ['z.ts']) });
    expect(v.fresh).toBe(true);
    expect(v.mainSha).toBe('m1');
    expect(v.distance).toBe(5);
  });

  it('seam 주입 → stale(겹침)', () => {
    const v = regateFreshness({ baseSha: 'b1', phaseFiles: ['a.ts', 'b.ts'], git: fakeGit('m1', 2, ['b.ts']) });
    expect(v.fresh).toBe(false);
    expect(v.staleFiles).toEqual(['b.ts']);
  });
});
