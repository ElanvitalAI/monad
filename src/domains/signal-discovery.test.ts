// 발굴형 해상도 씨앗 단위테스트 — 순수. A6.
import { test, expect, describe } from 'bun:test';
import type { ResolutionGap } from './signal-metrics.js';
import { gapToSeed, gapsToSeeds } from './signal-discovery.js';
import { detectDomain } from '../autopilot/domain/detect.js';

const gap = (over: Partial<ResolutionGap> = {}): ResolutionGap => ({
  kind: 'high-false-positive', value: 0.83, threshold: 0.6,
  note: '2차 오탐율 83% > 60%', suggestion: '...', ...over,
});

describe('gapToSeed', () => {
  test('안정 제목(수치 제외) + 수치는 rationale', () => {
    const s = gapToSeed(gap());
    expect(s.title).toBe('신호 파이프라인 1차 게이트 오탐 원인 분석 리서치');
    expect(s.title).not.toContain('83');       // dedup 안정 — 제목에 변동 수치 없음
    expect(s.rationale).toContain('0.83');      // 수치는 rationale
    expect(s.tier).toBe('light');
  });
  test('제목이 business 도메인으로 감지(A4c 자동수용 대상·부작용 없음)', () => {
    for (const k of ['high-false-positive', 'low-gate2-coverage', 'severity-inflation', 'digest-backlog'] as const) {
      const s = gapToSeed(gap({ kind: k }));
      expect(detectDomain(s.title)).toBe('business');   // investment/coding 아님 → 경계 밖
    }
  });
});

describe('gapsToSeeds', () => {
  test('중복 kind 제거', () => {
    const seeds = gapsToSeeds([gap(), gap(), gap({ kind: 'digest-backlog' })]);
    expect(seeds.length).toBe(2);
    expect(seeds.map((s) => s.slug).sort()).toEqual(['adaptive-resolution-digest-backlog', 'adaptive-resolution-high-false-positive']);
  });
  test('빈 갭 → 빈 씨앗', () => {
    expect(gapsToSeeds([])).toEqual([]);
  });
});
