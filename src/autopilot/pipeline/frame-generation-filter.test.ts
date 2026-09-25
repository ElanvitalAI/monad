// H6 — 프레임 세대 필터(replay/rewind/goto 세대 인지) 순수 테스트
import { describe, expect, it } from 'bun:test';
import { effectiveGeneration, latestGeneration, framesForGeneration } from './frame-generation-filter.js';

const f = (seq: number, generation?: number) => ({ seq, ...(generation !== undefined ? { generation } : {}) });

describe('effectiveGeneration — pre-H4 undefined=0', () => {
  it('undefined → 0(원 세대)', () => expect(effectiveGeneration(f(1))).toBe(0));
  it('명시 값 그대로', () => expect(effectiveGeneration(f(1, 3))).toBe(3));
});

describe('latestGeneration', () => {
  it('빈 배열 → 0', () => expect(latestGeneration([])).toBe(0));
  it('혼합 → 최대(undefined=0 포함)', () => expect(latestGeneration([f(1), f(2, 1), f(3, 2), f(4)])).toBe(2));
  it('전부 undefined → 0', () => expect(latestGeneration([f(1), f(2)])).toBe(0));
});

describe('framesForGeneration', () => {
  const frames = [f(1), f(2, 0), f(3, 1), f(4, 1), f(5, 2)];

  it('미지정 → 최신 세대만(gen 2)', () => {
    expect(framesForGeneration(frames).map((x) => x.seq)).toEqual([5]);
  });
  it('gen 1 지정 → gen1 만', () => {
    expect(framesForGeneration(frames, 1).map((x) => x.seq)).toEqual([3, 4]);
  });
  it('gen 0 지정 → undefined(=0)+명시 0 포함', () => {
    expect(framesForGeneration(frames, 0).map((x) => x.seq)).toEqual([1, 2]);
  });
  it('never-reran(전부 undefined) → 최신=0 → 전부 포함(behavior 불변)', () => {
    const g0 = [f(1), f(2), f(3)];
    expect(framesForGeneration(g0).map((x) => x.seq)).toEqual([1, 2, 3]);
  });
});
